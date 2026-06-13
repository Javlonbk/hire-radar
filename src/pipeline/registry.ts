import { createHhAdapter } from '../adapters/hh.js';
import { createRssAdapter } from '../adapters/rss.js';
import { createTelegramAdapter } from '../adapters/telegram.js';
import type { SourceAdapter } from '../adapters/types.js';
import type { Config } from '../config.js';

export function buildAdapters(config: Config): SourceAdapter[] {
  const adapters: SourceAdapter[] = [
    createHhAdapter({ area: config.hh.area, text: config.hh.text, perPage: config.hh.perPage }),
  ];
  for (const url of config.rss.feeds) {
    adapters.push(createRssAdapter({ url }));
  }
  for (const channel of config.telegram.channels) {
    adapters.push(createTelegramAdapter({
      channel,
      apiId: config.telegramApiId,
      apiHash: config.telegramApiHash,
      session: config.telegramSession,
    }));
  }
  return adapters;
}
