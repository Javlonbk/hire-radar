import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { EXTRACTION_TOOL } from './schema.js';

export type MessageCreate = (params: MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export async function callClaude(
  messageCreate: MessageCreate,
  args: { model: string; system: string; userText: string },
): Promise<unknown> {
  const res = await messageCreate({
    model: args.model,
    max_tokens: 4096,
    system: args.system,
    messages: [{ role: 'user', content: args.userText }],
    tools: [EXTRACTION_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
  });
  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error('Claude response contained no tool_use block');
  }
  return block.input;
}

export function realMessageCreate(apiKey: string): MessageCreate {
  const client = new Anthropic({ apiKey });
  return client.messages.create.bind(client.messages) as MessageCreate;
}
