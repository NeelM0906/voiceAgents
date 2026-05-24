import { Hono } from 'hono';
import { detectSmsComplianceKeyword, isOptedOut } from '../compliance/optout.js';
import { config } from '../config.js';
import { getOrCreateConversationByContact } from '../db/conversations.js';
import { deleteConsumerOptout, upsertConsumerOptout } from '../db/optouts.js';
import { getTenantByPhoneNumber } from '../db/tenants.js';
import { inngest } from '../inngest/client.js';
import { smsInboundReceivedEvent } from '../inngest/events.js';
import { logger } from '../logger.js';
import { sendSmsRaw } from '../twilio/client.js';
import { validateTwilioSignature } from '../twilio/signature.js';
import { normalizePhoneE164 } from '../utils/phone.js';

const EMPTY_TWIML = '<Response/>';
const SMS_WEBHOOK_PATH = '/webhooks/twilio/sms';
const routeLogger = logger.child({ component: 'api', route: 'twilio-sms-webhook' });

export const webhookRoutes = new Hono();

webhookRoutes.post('/twilio/sms', async (c) => {
  let messageSid: string | undefined;

  try {
    const params = await parseFormParams(c.req.raw);
    messageSid = params.MessageSid;
    const length = params.Body?.length ?? 0;
    const logFields = {
      messageSid,
      length,
    };

    const signature = c.req.header('x-twilio-signature');

    if (!signature) {
      routeLogger.warn(logFields, 'missing Twilio signature');
      return c.text('forbidden', 403);
    }

    const missingFields = ['MessageSid', 'From', 'To', 'Body', 'AccountSid'].filter(
      (field) => !params[field],
    );

    if (missingFields.length > 0) {
      routeLogger.warn({ ...logFields, missingFields }, 'missing Twilio webhook fields');
      return c.json({ error: 'invalid_request', missing_fields: missingFields }, 400);
    }

    if (params.AccountSid !== config.TWILIO_ACCOUNT_SID) {
      routeLogger.warn({ ...logFields, accountSid: params.AccountSid }, 'Twilio AccountSid mismatch');
      return c.text('forbidden', 403);
    }

    const webhookUrl = new URL(SMS_WEBHOOK_PATH, config.PUBLIC_BASE_URL).toString();
    const validSignature = validateTwilioSignature({
      authToken: requireTwilioAuthToken(),
      signature,
      url: webhookUrl,
      params,
    });

    if (!validSignature) {
      routeLogger.warn(logFields, 'invalid Twilio signature');
      return c.text('forbidden', 403);
    }

    const contactPhone = normalizePhoneE164(params.From);
    const calledNumber = normalizePhoneE164(params.To);

    if (!contactPhone || !calledNumber) {
      routeLogger.warn(
        {
          ...logFields,
          fromValid: Boolean(contactPhone),
          toValid: Boolean(calledNumber),
        },
        'Twilio webhook phone normalization failed',
      );
      return emptyTwiML();
    }

    const tenantConfig = await getTenantByPhoneNumber(calledNumber);

    if (!tenantConfig || tenantConfig.tenant.status !== 'active') {
      routeLogger.warn(
        {
          ...logFields,
          calledNumber,
          tenantId: tenantConfig?.tenant.id,
          tenantStatus: tenantConfig?.tenant.status,
        },
        'SMS webhook received for unavailable tenant',
      );
      return emptyTwiML();
    }

    const complianceKeyword = detectSmsComplianceKeyword(params.Body);

    if (complianceKeyword === 'stop') {
      await upsertConsumerOptout({
        tenantId: tenantConfig.tenant.id,
        contactPhone,
        reason: 'stop_keyword',
      });
      await sendSmsRaw({
        from: calledNumber,
        to: contactPhone,
        body: 'You are unsubscribed. No more messages will be sent. Reply START to resubscribe.',
      });

      routeLogger.info(
        {
          ...logFields,
          tenantId: tenantConfig.tenant.id,
          keyword: complianceKeyword,
        },
        'handled SMS compliance keyword',
      );
      return emptyTwiML();
    }

    if (complianceKeyword === 'start') {
      await deleteConsumerOptout({
        tenantId: tenantConfig.tenant.id,
        contactPhone,
      });
      await sendSmsRaw({
        from: calledNumber,
        to: contactPhone,
        body: 'You are resubscribed. Reply STOP to opt out anytime.',
      });

      routeLogger.info(
        {
          ...logFields,
          tenantId: tenantConfig.tenant.id,
          keyword: complianceKeyword,
        },
        'handled SMS compliance keyword',
      );
      return emptyTwiML();
    }

    if (complianceKeyword === 'help') {
      await sendSmsRaw({
        from: calledNumber,
        to: contactPhone,
        body: `${tenantConfig.tenant.name}: AI assistant for inbound texts. Reply STOP to opt out. Msg & data rates may apply.`,
      });

      routeLogger.info(
        {
          ...logFields,
          tenantId: tenantConfig.tenant.id,
          keyword: complianceKeyword,
        },
        'handled SMS compliance keyword',
      );
      return emptyTwiML();
    }

    if (
      await isOptedOut({
        tenantId: tenantConfig.tenant.id,
        contactPhone,
      })
    ) {
      routeLogger.info(
        {
          ...logFields,
          tenantId: tenantConfig.tenant.id,
        },
        'ignored inbound SMS from opted-out contact',
      );
      return emptyTwiML();
    }

    const conversation = await getOrCreateConversationByContact({
      tenantId: tenantConfig.tenant.id,
      contactPhone,
    });

    await inngest.send(
      smsInboundReceivedEvent.create(
        {
          tenantId: tenantConfig.tenant.id,
          conversationId: conversation.id,
          contactPhone,
          calledNumber,
          body: params.Body,
          messageSid: params.MessageSid,
        },
        {
          id: params.MessageSid,
        },
      ),
    );

    routeLogger.info(
      {
        ...logFields,
        tenantId: tenantConfig.tenant.id,
        conversationId: conversation.id,
      },
      'queued inbound SMS event',
    );

    return emptyTwiML();
  } catch (error) {
    routeLogger.error({ messageSid, error }, 'Twilio SMS webhook failed');
    return emptyTwiML();
  }
});

async function parseFormParams(request: Request): Promise<Record<string, string>> {
  const formData = await request.formData();
  const params: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      params[key] = value;
    }
  }

  return params;
}

function emptyTwiML(): Response {
  return new Response(EMPTY_TWIML, {
    status: 200,
    headers: {
      'content-type': 'text/xml; charset=utf-8',
    },
  });
}

function requireTwilioAuthToken(): string {
  if (!config.TWILIO_AUTH_TOKEN) {
    throw new Error('TWILIO_AUTH_TOKEN is required for webhook validation');
  }

  return config.TWILIO_AUTH_TOKEN;
}
