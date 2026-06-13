import { describe, expect, it } from 'vitest';
import { buildAdapters } from './registry.js';
import type { Config } from '../config.js';

function makeConfig(feeds: string[], channels: string[] = []): Config {
  return {
    anthropicApiKey: 'test-key',
    telegram: { channels },
    hh: { area: '97', text: 'developer', perPage: 10 },
    rss: { feeds },
    anthropicModel: 'claude-haiku-4-5',
  };
}

describe('buildAdapters', () => {
  it('returns one hh adapter plus one rss adapter per feed', () => {
    const adapters = buildAdapters(makeConfig([
      'https://example.com/feed1.xml',
      'https://example.com/feed2.xml',
    ]));
    expect(adapters).toHaveLength(3);
    expect(adapters[0].id).toBe('hh:uz');
    expect(adapters[1].id).toMatch(/^rss:/);
    expect(adapters[2].id).toMatch(/^rss:/);
    expect(adapters[1].id).not.toBe(adapters[2].id);
  });

  it('returns only hh adapter when rss.feeds is empty', () => {
    const adapters = buildAdapters(makeConfig([]));
    expect(adapters).toHaveLength(1);
    expect(adapters[0].id).toBe('hh:uz');
  });

  it('returns telegram adapters for each configured channel', () => {
    const adapters = buildAdapters(makeConfig(['https://example.com/feed.xml'], ['chan_a', 'chan_b']));
    expect(adapters).toHaveLength(4);
    const ids = adapters.map(a => a.id);
    expect(ids).toContain('telegram:chan_a');
    expect(ids).toContain('telegram:chan_b');
  });
});
