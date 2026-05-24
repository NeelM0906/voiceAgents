import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

export type SmsHistoryMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  channel?: 'sms' | 'voice';
  createdAt: Date;
};

export async function generateSmsReply(input: {
  systemPrompt: string;
  history: SmsHistoryMessage[];
  userMessage: string;
  model?: string;
}): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: input.systemPrompt,
    },
  ];

  if (input.history.length > 0) {
    messages.push({
      role: 'system',
      content: `Recent context (most recent last):\n${input.history.map(formatLine).join('\n')}`,
    });
  }

  messages.push({
    role: 'user',
    content: input.userMessage,
  });

  const completion = await openai.chat.completions.create({
    model: input.model ?? config.OPENAI_SMS_MODEL,
    messages,
    temperature: 0.6,
    max_tokens: 220,
  });

  const reply = completion.choices[0]?.message.content?.trim();

  if (!reply) {
    throw new Error('OpenAI SMS completion returned an empty reply');
  }

  return reply;
}

function formatLine(message: SmsHistoryMessage): string {
  const timestamp = message.createdAt.toISOString().slice(0, 16).replace('T', ' ');
  const channel = message.channel ?? 'sms';

  return `[${timestamp}] [${channel}] [${message.role}]: ${message.content}`;
}
