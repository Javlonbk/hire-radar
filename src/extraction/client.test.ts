import { describe, it, expect, vi } from 'vitest';
import type { MessageCreate } from './client.js';
import { callClaude } from './client.js';
import { EXTRACTION_TOOL } from './schema.js';

function makeToolUseMessage(input: unknown) {
  return {
    id: 'msg_test',
    type: 'message' as const,
    role: 'assistant' as const,
    content: [
      {
        type: 'tool_use' as const,
        id: 'tool_test',
        name: EXTRACTION_TOOL.name,
        input,
        caller: { type: 'direct' as const },
      },
    ],
    model: 'claude-haiku-4-5',
    stop_reason: 'tool_use' as const,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

function makeTextMessage() {
  return {
    id: 'msg_test',
    type: 'message' as const,
    role: 'assistant' as const,
    content: [
      {
        type: 'text' as const,
        text: 'I cannot help with that.',
      },
    ],
    model: 'claude-haiku-4-5',
    stop_reason: 'end_turn' as const,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

describe('callClaude', () => {
  it('returns tool_use block input when response contains a tool_use block', async () => {
    const expectedInput = { is_job_post: true, vacancies: [] };
    const fake: MessageCreate = vi.fn().mockResolvedValue(makeToolUseMessage(expectedInput));

    const result = await callClaude(fake, {
      model: 'claude-haiku-4-5',
      system: 'Extract vacancies.',
      userText: 'We are hiring a developer.',
    });

    expect(result).toEqual(expectedInput);
  });

  it('calls messageCreate with correct model, tools containing extract_vacancies, and forced tool_choice', async () => {
    const fake: MessageCreate = vi.fn().mockResolvedValue(makeToolUseMessage({}));

    await callClaude(fake, {
      model: 'claude-haiku-4-5',
      system: 'Extract vacancies.',
      userText: 'We are hiring.',
    });

    expect(vi.mocked(fake)).toHaveBeenCalledOnce();
    const params = vi.mocked(fake).mock.calls[0][0];
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.tools).toBeDefined();
    const tool = (params.tools as Array<{ name: string }>).find(t => t.name === 'extract_vacancies');
    expect(tool).toBeDefined();
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'extract_vacancies' });
  });

  it('throws when response contains no tool_use block', async () => {
    const fake: MessageCreate = vi.fn().mockResolvedValue(makeTextMessage());

    await expect(
      callClaude(fake, { model: 'claude-haiku-4-5', system: 'Extract.', userText: 'Hello world.' }),
    ).rejects.toThrow('Claude response contained no tool_use block');
  });
});
