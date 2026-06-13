import { contentHash } from '../hash.js';
import type { RawItem, SourceAdapter } from './types.js';

export interface HhOptions {
  area: string;
  text: string;
  perPage: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export function createHhAdapter(opts: HhOptions): SourceAdapter {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const log = opts.log ?? console.warn;

  return {
    id: 'hh:uz',

    async fetch(since: Date): Promise<RawItem[]> {
      const items: RawItem[] = [];
      let page = 0;
      let totalPages = 1;

      while (page < totalPages && page < 20) {
        const url = new URL('https://api.hh.ru/vacancies');
        url.searchParams.set('area', opts.area);
        url.searchParams.set('text', opts.text);
        url.searchParams.set('per_page', String(opts.perPage));
        url.searchParams.set('page', String(page));
        url.searchParams.set('date_from', since.toISOString());

        const response = await fetchFn(url.toString(), {
          headers: { 'User-Agent': 'hire-radar/0.1 (+https://github.com/hire-radar)' },
        });

        if (!response.ok) {
          throw new Error(`hh.uz returned HTTP ${response.status} (page ${page})`);
        }

        const body = await response.json() as {
          found: number;
          pages: number;
          items: Array<{
            id: string;
            name?: string;
            employer?: { name?: string };
            snippet?: { requirement?: string; responsibility?: string };
          }>;
        };

        if (page === 0) {
          totalPages = body.pages;
          if (body.found > 2000) {
            log(`hh.uz: query matched ${body.found} results but API caps at 2000 — narrow hh.text/hh.area`);
          }
        }

        for (const item of body.items) {
          const nativeId = String(item.id);
          const rawText = [
            item.name,
            item.employer?.name,
            item.snippet?.requirement,
            item.snippet?.responsibility,
          ].filter(Boolean).join('\n');

          items.push({
            sourceId: 'hh:uz',
            nativeId,
            rawText,
            rawJson: {
              id: item.id,
              name: item.name,
              employer: { name: item.employer?.name },
              snippet: {
                requirement: item.snippet?.requirement,
                responsibility: item.snippet?.responsibility,
              },
            },
            fetchedAt: new Date(),
            contentHash: contentHash('hh:uz:' + nativeId),
          });
        }

        page++;
        if (page < totalPages && page < 20) {
          await sleep(500);
        }
      }

      return items;
    },
  };
}
