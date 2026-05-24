import type { CallRow, EscalationRow, Json, MessageRow } from '../db/types.js';

export function formatConversationNote(input: {
  tenantName: string;
  contactPhone: string;
  call?: CallRow | null;
  messages: MessageRow[];
  escalations: EscalationRow[];
}): string {
  const lines: string[] = [
    `AI receptionist conversation for ${input.tenantName}`,
    `Contact: ${input.contactPhone}`,
  ];

  if (input.call) {
    lines.push(`Call: ${input.call.id}`);
    lines.push(`Started: ${input.call.started_at}`);

    if (input.call.ended_at) {
      lines.push(`Ended: ${input.call.ended_at}`);
    }

    if (input.call.summary) {
      lines.push('', 'Summary:', input.call.summary);
    }

    if (input.call.key_facts) {
      lines.push('', 'Key facts:', JSON.stringify(normalizeJson(input.call.key_facts), null, 2));
    }

    if (input.call.outcome) {
      lines.push('', `Outcome: ${input.call.outcome}`);
    }
  }

  if (input.escalations.length > 0) {
    lines.push('', 'Escalations:');
    for (const escalation of input.escalations) {
      lines.push(`- ${escalation.created_at} [${escalation.source}] ${escalation.reason}`);
    }
  }

  lines.push('', 'Transcript:');

  for (const message of input.messages) {
    lines.push(
      `[${message.created_at}] [${message.channel}] [${message.role}] ${message.content}`,
    );
  }

  return lines.join('\n');
}

function normalizeJson(value: Json): Json {
  return value;
}
