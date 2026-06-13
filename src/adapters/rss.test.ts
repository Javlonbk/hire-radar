import { describe, it, expect, vi } from 'vitest';
import iconv from 'iconv-lite';
import { createRssAdapter } from './rss.js';

// Build a windows-1251-encoded RSS buffer with one Cyrillic item
function makeWin1251Feed(title: string, pubDate: string): Buffer {
  const xml = `<?xml version="1.0" encoding="windows-1251"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <item>
      <title>${title}</title>
      <guid>item-1</guid>
      <pubDate>${pubDate}</pubDate>
    </item>
  </channel>
</rss>`;
  return iconv.encode(xml, 'windows-1251');
}

function makeUtf8Feed(items: Array<{ title: string; guid: string; pubDate: string }>): Buffer {
  const itemsXml = items
    .map(
      i => `<item><title>${i.title}</title><guid>${i.guid}</guid><pubDate>${i.pubDate}</pubDate></item>`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Jobs</title>
    ${itemsXml}
  </channel>
</rss>`;
  return Buffer.from(xml, 'utf8');
}

function mockResponse(body: Buffer, status = 200, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}

describe('createRssAdapter', () => {
  it('throws on non-http(s) URLs (SSRF guard)', () => {
    expect(() => createRssAdapter({ url: 'file:///etc/passwd' })).toThrow(/http/i);
    expect(() => createRssAdapter({ url: 'ftp://evil.example/feed.xml' })).toThrow(/http/i);
  });

  it('rejects internal/metadata hosts (SSRF guard)', () => {
    expect(() => createRssAdapter({ url: 'http://169.254.169.254/latest/meta-data/' })).toThrow(/blocked internal host/i);
    expect(() => createRssAdapter({ url: 'http://localhost:6379/' })).toThrow(/blocked internal host/i);
    expect(() => createRssAdapter({ url: 'http://127.0.0.1/feed' })).toThrow(/blocked internal host/i);
    expect(() => createRssAdapter({ url: 'http://10.0.0.5/feed' })).toThrow(/blocked internal host/i);
    expect(() => createRssAdapter({ url: 'http://192.168.1.1/feed' })).toThrow(/blocked internal host/i);
    expect(() => createRssAdapter({ url: 'http://172.16.0.1/feed' })).toThrow(/blocked internal host/i);
  });

  it('accepts http and https URLs without throwing', () => {
    expect(() => createRssAdapter({ url: 'http://example.com/feed.rss' })).not.toThrow();
    expect(() => createRssAdapter({ url: 'https://example.com/feed.rss' })).not.toThrow();
  });

  it('decodes windows-1251 feed without mojibake', async () => {
    const cyrillicTitle = 'Вакансия разработчика';
    const since = new Date('2020-01-01T00:00:00Z');
    const pubDate = 'Mon, 01 Jan 2024 10:00:00 +0000';
    const buf = makeWin1251Feed(cyrillicTitle, pubDate);

    const fetchFn = vi.fn().mockResolvedValue(mockResponse(buf));
    const adapter = createRssAdapter({ url: 'https://example.com/feed.rss', fetchFn });

    const items = await adapter.fetch(since);

    expect(items).toHaveLength(1);
    expect(items[0].rawText).toContain('Вакансия');
    expect(items[0].rawText).not.toContain('Ð'); // no mojibake
  });

  it('falls back to Content-Type charset when the XML declaration omits encoding', async () => {
    const cyrillicTitle = 'Вакансия инженера';
    const since = new Date('2020-01-01T00:00:00Z');
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Test</title>
  <item><title>${cyrillicTitle}</title><guid>item-1</guid><pubDate>Mon, 01 Jan 2024 10:00:00 +0000</pubDate></item>
</channel></rss>`;
    const buf = iconv.encode(xml, 'windows-1251');
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse(buf, 200, { 'content-type': 'application/rss+xml; charset=windows-1251' }));
    const adapter = createRssAdapter({ url: 'https://example.com/feed.rss', fetchFn });

    const items = await adapter.fetch(since);

    expect(items[0].rawText).toContain('Вакансия');
    expect(items[0].rawText).not.toContain('Ð');
  });

  it('stores a whitelisted rawJson, not the full parser item', async () => {
    const since = new Date('2020-01-01T00:00:00Z');
    const buf = makeUtf8Feed([
      { title: 'Job', guid: 'g-1', pubDate: 'Mon, 10 Jun 2024 10:00:00 +0000' },
    ]);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse(buf));
    const adapter = createRssAdapter({ url: 'https://example.com/feed.rss', fetchFn });

    const items = await adapter.fetch(since);
    const keys = Object.keys(items[0].rawJson as object).sort();
    expect(keys).toEqual(['content', 'guid', 'link', 'pubDate', 'title']);
  });

  it('filters out items older than since', async () => {
    const since = new Date('2024-06-01T00:00:00Z');
    const buf = makeUtf8Feed([
      { title: 'New job', guid: 'new-1', pubDate: 'Mon, 10 Jun 2024 10:00:00 +0000' },
      { title: 'Old job', guid: 'old-1', pubDate: 'Mon, 01 Jan 2024 10:00:00 +0000' },
    ]);

    const fetchFn = vi.fn().mockResolvedValue(mockResponse(buf));
    const adapter = createRssAdapter({ url: 'https://example.com/feed.rss', fetchFn });

    const items = await adapter.fetch(since);

    expect(items).toHaveLength(1);
    expect(items[0].nativeId).toBe('new-1');
  });

  it('derives distinct nativeIds for items lacking both guid and link', async () => {
    const since = new Date('2020-01-01T00:00:00Z');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Jobs</title>
  <item><title>Job A</title><pubDate>Mon, 10 Jun 2024 10:00:00 +0000</pubDate></item>
  <item><title>Job B</title><pubDate>Mon, 11 Jun 2024 10:00:00 +0000</pubDate></item>
</channel></rss>`;
    const fetchFn = vi.fn().mockResolvedValue(mockResponse(Buffer.from(xml, 'utf8')));
    const adapter = createRssAdapter({ url: 'https://example.com/feed.rss', fetchFn });

    const items = await adapter.fetch(since);

    expect(items).toHaveLength(2);
    expect(items[0].nativeId).not.toBe('undefined');
    expect(items[1].nativeId).not.toBe('undefined');
    expect(items[0].nativeId).not.toBe(items[1].nativeId);
    expect(items[0].contentHash).not.toBe(items[1].contentHash);
  });

  it('returns [] on 304 and sends If-None-Match on second call', async () => {
    const since = new Date('2020-01-01T00:00:00Z');
    const buf = makeUtf8Feed([
      { title: 'Job', guid: 'g-1', pubDate: 'Mon, 10 Jun 2024 10:00:00 +0000' },
    ]);

    const firstResponse = mockResponse(buf, 200, { etag: '"abc123"' });
    const secondResponse = mockResponse(Buffer.alloc(0), 304);

    const fetchFn = vi.fn().mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(secondResponse);

    const adapter = createRssAdapter({ url: 'https://example.com/feed.rss', fetchFn });

    await adapter.fetch(since);
    const second = await adapter.fetch(since);

    expect(second).toEqual([]);

    const secondCallHeaders = fetchFn.mock.calls[1][1].headers as Record<string, string>;
    expect(secondCallHeaders['If-None-Match']).toBe('"abc123"');
  });

  it('throws on non-OK HTTP status instead of parsing the error body', async () => {
    const since = new Date('2020-01-01T00:00:00Z');
    const fetchFn = vi.fn().mockResolvedValue(mockResponse(Buffer.from('<html>500</html>'), 500));
    const adapter = createRssAdapter({ url: 'https://example.com/feed.rss', fetchFn });

    await expect(adapter.fetch(since)).rejects.toThrow(/HTTP 500/);
  });

  it('does not overwrite conditional-GET state on a non-OK response', async () => {
    const since = new Date('2020-01-01T00:00:00Z');
    const buf = makeUtf8Feed([
      { title: 'Job', guid: 'g-1', pubDate: 'Mon, 10 Jun 2024 10:00:00 +0000' },
    ]);

    const firstResponse = mockResponse(buf, 200, { etag: '"abc123"' });
    const errorResponse = mockResponse(Buffer.from('rate limited'), 429);

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(mockResponse(buf, 200, { etag: '"abc123"' }));

    const adapter = createRssAdapter({ url: 'https://example.com/feed.rss', fetchFn });

    await adapter.fetch(since);
    await expect(adapter.fetch(since)).rejects.toThrow();
    await adapter.fetch(since);

    const thirdCallHeaders = fetchFn.mock.calls[2][1].headers as Record<string, string>;
    expect(thirdCallHeaders['If-None-Match']).toBe('"abc123"');
  });
});
