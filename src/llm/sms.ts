import OpenAI from 'openai';
import { config } from '../config.js';
import {
  searchMethodology,
  searchMethodologyArgsSchema,
} from '../rag/tools/search_methodology.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

const MAX_TOOL_ITERATIONS = 3;

const searchMethodologyTool = {
  type: 'function',
  function: {
    name: 'search_methodology',
    description:
      "Search the company methodology library for guidance on handling this caller's situation. Use when the caller's question or situation calls for specific framing, scripts, or escalation rules.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
        },
        top_k: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          default: 5,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
} satisfies OpenAI.Chat.Completions.ChatCompletionTool;

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
  tenantId?: string;
}): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${input.systemPrompt}\n\nUse search_methodology when a caller's situation requires company methodology, objection handling, pricing framing, emergency triage, or closing-loop guidance. Keep the final SMS concise and grounded in retrieved guidance when used.`,
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

  const model = input.model ?? config.OPENAI_SMS_MODEL;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      tools: [searchMethodologyTool],
      tool_choice: 'auto',
      temperature: 0.6,
      max_tokens: 220,
    });
    const message = completion.choices[0]?.message;
    const toolCalls = message?.tool_calls ?? [];

    if (!message) {
      throw new Error('OpenAI SMS completion returned no message');
    }

    if (toolCalls.length === 0) {
      const reply = message.content?.trim();

      if (!reply) {
        throw new Error('OpenAI SMS completion returned an empty reply');
      }

      return reply;
    }

    messages.push(toAssistantToolCallMessage(message));

    for (const toolCall of toolCalls) {
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(await executeToolCall(toolCall, input.tenantId)),
      });
    }
  }

  const finalCompletion = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.6,
    max_tokens: 220,
  });

  const reply = finalCompletion.choices[0]?.message.content?.trim();

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

function toAssistantToolCallMessage(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  const functionToolCalls = (message.tool_calls ?? []).filter(isFunctionToolCall);

  return {
    role: 'assistant',
    content: message.content ?? null,
    tool_calls: functionToolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    })),
  };
}

async function executeToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  tenantId: string | undefined,
) {
  if (!isFunctionToolCall(toolCall)) {
    return {
      error: 'unsupported_custom_tool',
    };
  }

  if (toolCall.function.name !== 'search_methodology') {
    return {
      error: 'unknown_tool',
    };
  }

  const parsedArgs = searchMethodologyArgsSchema.parse(JSON.parse(toolCall.function.arguments));

  return searchMethodology({
    query: parsedArgs.query,
    topK: parsedArgs.top_k,
    tenantId,
  });
}

function isFunctionToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
): toolCall is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall {
  return toolCall.type === 'function';
}
