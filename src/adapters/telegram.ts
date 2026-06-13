import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { FloodWaitError } from 'telegram/errors/index.js';
import { contentHash } from '../hash.js';
import type { RawItem, SourceAdapter } from './types.js';

export interface TelegramLike {
  connect(): Promise<void>;
  isUserAuthorized(): Promise<boolean>;
  getMessages(channel: string, opts: { limit: number; offsetId?: number }): Promise<Array<{ id: number; message?: string; date: number }>>;
}

const PAGE_SIZE = 100;

export interface TelegramOptions {
  channel: string;
  apiId?: number;
  apiHash?: string;
  session?: string;
  clientFactory?: (apiId: number, apiHash: string, session: string) => TelegramLike;
  sleep?: (ms: number) => Promise<void>;
  jitterMs?: () => number;
}

function defaultFactory(apiId: number, apiHash: string, session: string): TelegramLike {
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
    floodSleepThreshold: 300,
  }) as unknown as TelegramLike;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const defaultJitterMs = (): number => 2000 + Math.floor(Math.random() * 3000);

export function createTelegramAdapter(opts: TelegramOptions): SourceAdapter {
  const id = 'telegram:' + opts.channel;

  return {
    id,

    async fetch(since: Date): Promise<RawItem[]> {
      if (!opts.apiId || !opts.apiHash || !opts.session) {
        throw new Error(
          `Telegram session missing for ${opts.channel} — run \`hire-radar auth\` to authenticate`,
        );
      }

      const sleep = opts.sleep ?? defaultSleep;
      const jitterMs = opts.jitterMs ?? defaultJitterMs;
      const factory = opts.clientFactory ?? defaultFactory;

      const client = factory(opts.apiId, opts.apiHash, opts.session);
      await client.connect();

      if (!(await client.isUserAuthorized())) {
        throw new Error(
          `Telegram session expired for ${opts.channel} — run \`hire-radar auth\` to re-authenticate`,
        );
      }

      await sleep(jitterMs());

      async function readPage(offsetId?: number): Promise<Array<{ id: number; message?: string; date: number }>> {
        try {
          return await client.getMessages(opts.channel, { limit: PAGE_SIZE, offsetId });
        } catch (e) {
          if (e instanceof FloodWaitError) {
            await sleep(e.seconds * 1150);
            return await client.getMessages(opts.channel, { limit: PAGE_SIZE, offsetId });
          }
          throw e;
        }
      }

      const sinceMs = since.getTime();
      const items: RawItem[] = [];
      let offsetId: number | undefined;

      // getMessages returns newest-first; page backwards via offsetId until a
      // message older than `since` is seen or the channel is exhausted.
      for (;;) {
        const page = await readPage(offsetId);
        if (page.length === 0) break;

        let reachedOlder = false;
        for (const m of page) {
          if (m.date * 1000 < sinceMs) {
            reachedOlder = true;
            continue;
          }
          if (!m.message) continue;
          items.push({
            sourceId: id,
            nativeId: String(m.id),
            rawText: m.message,
            rawJson: { id: m.id, date: m.date },
            fetchedAt: new Date(),
            contentHash: contentHash(id + ':' + m.id),
          });
        }

        if (reachedOlder || page.length < PAGE_SIZE) break;
        offsetId = page[page.length - 1].id;
        await sleep(jitterMs());
      }

      return items;
    },
  };
}
