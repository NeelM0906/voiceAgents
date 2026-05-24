import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getApiConfig } from './config.js';
import { logger } from './logger.js';
import { conversationRoutes } from './routes/conversations.js';
import { healthRoutes } from './routes/health.js';
import { inngestRoutes } from './routes/inngest.js';
import { smsConfigRoutes } from './routes/sms_config.js';
import { tenantRoutes } from './routes/tenants.js';
import { webhookRoutes } from './routes/webhooks.js';

const apiConfig = getApiConfig();
const apiLogger = logger.child({ component: 'admin-api' });

export const app = new Hono();

app.route('/', healthRoutes);
app.route('/webhooks', webhookRoutes);
app.route('/api/inngest', inngestRoutes);

app.use('/admin/*', async (c, next) => {
  const apiKey = c.req.header('x-api-key');

  if (apiKey !== apiConfig.ADMIN_API_KEY) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  await next();
});

app.route('/admin/tenants', tenantRoutes);
app.route('/admin/tenants', smsConfigRoutes);
app.route('/admin/tenants', conversationRoutes);

serve(
  {
    fetch: app.fetch,
    port: apiConfig.API_PORT,
  },
  (info) => {
    apiLogger.info({ port: info.port }, 'admin API listening');
  },
);
