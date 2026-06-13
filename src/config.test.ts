import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';

const VALID_CONFIG = {
  telegram: { channels: ['itpark_jobs'] },
  hh: { area: '97', text: 'developer', perPage: 100 },
  rss: { feeds: ['https://example.com/jobs.rss'] },
};

const VALID_ENV: NodeJS.ProcessEnv = {
  ANTHROPIC_API_KEY: 'sk-test-key',
  TELEGRAM_API_ID: '12345',
  TELEGRAM_API_HASH: 'abc123hash',
};

let tmpConfigPath: string;

beforeEach(() => {
  tmpConfigPath = join(tmpdir(), `config-test-${Date.now()}.json`);
  writeFileSync(tmpConfigPath, JSON.stringify(VALID_CONFIG));
});

afterEach(() => {
  try { unlinkSync(tmpConfigPath); } catch {}
});

describe('loadConfig', () => {
  it('returns a typed Config when configPath and env are valid', () => {
    const config = loadConfig({ configPath: tmpConfigPath, env: VALID_ENV });
    expect(config.telegram.channels).toEqual(['itpark_jobs']);
    expect(config.hh.area).toBe('97');
    expect(config.hh.perPage).toBe(100);
    expect(config.rss.feeds).toEqual(['https://example.com/jobs.rss']);
    expect(config.anthropicApiKey).toBe('sk-test-key');
  });

  it('throws an error naming ANTHROPIC_API_KEY when it is missing', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV };
    delete env.ANTHROPIC_API_KEY;
    expect(() => loadConfig({ configPath: tmpConfigPath, env })).toThrow('ANTHROPIC_API_KEY');
  });

  it('ignores any anthropicApiKey field in the config file — env governs', () => {
    const configWithSecret = {
      ...VALID_CONFIG,
      anthropicApiKey: 'file-should-be-ignored',
    };
    writeFileSync(tmpConfigPath, JSON.stringify(configWithSecret));

    const envMissingKey: NodeJS.ProcessEnv = { ...VALID_ENV };
    delete envMissingKey.ANTHROPIC_API_KEY;
    expect(() => loadConfig({ configPath: tmpConfigPath, env: envMissingKey })).toThrow('ANTHROPIC_API_KEY');
  });

  it('TELEGRAM_SESSION absent is allowed — resolves without throwing', () => {
    const envNoSession: NodeJS.ProcessEnv = { ...VALID_ENV };
    delete envNoSession.TELEGRAM_SESSION;
    expect(() => loadConfig({ configPath: tmpConfigPath, env: envNoSession })).not.toThrow();
    const config = loadConfig({ configPath: tmpConfigPath, env: envNoSession });
    expect(config.telegramSession).toBeUndefined();
  });

  it('throws naming TELEGRAM_API_ID when it is an empty string instead of coercing to 0', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV, TELEGRAM_API_ID: '' };
    expect(() => loadConfig({ configPath: tmpConfigPath, env })).toThrow(
      'TELEGRAM_API_ID — set it in your .env file',
    );
  });

  it('throws naming TELEGRAM_API_ID when it is not a positive integer', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV, TELEGRAM_API_ID: 'abc' };
    expect(() => loadConfig({ configPath: tmpConfigPath, env })).toThrow('TELEGRAM_API_ID');
  });

  it('throws a Zod validation error naming the field when hh.perPage is not a number', () => {
    const badConfig = {
      ...VALID_CONFIG,
      hh: { ...VALID_CONFIG.hh, perPage: 'not-a-number' },
    };
    writeFileSync(tmpConfigPath, JSON.stringify(badConfig));
    expect(() => loadConfig({ configPath: tmpConfigPath, env: VALID_ENV })).toThrow(
      `hh.perPage — check ${tmpConfigPath}`,
    );
  });

  it('throws an actionable error when the config file is missing', () => {
    expect(() => loadConfig({ configPath: join(tmpdir(), 'no-such-config.json'), env: VALID_ENV })).toThrow(
      'copy config.example.json',
    );
  });

  it('throws an actionable error when the config file is malformed JSON', () => {
    writeFileSync(tmpConfigPath, '{ not json');
    expect(() => loadConfig({ configPath: tmpConfigPath, env: VALID_ENV })).toThrow(
      `Cannot read config file ${tmpConfigPath}`,
    );
  });

  it('throws an actionable error when the config file is not a JSON object', () => {
    writeFileSync(tmpConfigPath, 'null');
    expect(() => loadConfig({ configPath: tmpConfigPath, env: VALID_ENV })).toThrow(
      `Config file ${tmpConfigPath} must contain a JSON object`,
    );
  });

  it('points env-sourced fields at the .env file, not the config file', () => {
    const env: NodeJS.ProcessEnv = { ...VALID_ENV };
    delete env.ANTHROPIC_API_KEY;
    expect(() => loadConfig({ configPath: tmpConfigPath, env })).toThrow(
      'ANTHROPIC_API_KEY — set it in your .env file',
    );
  });

  it('returns anthropicModel === "claude-haiku-4-5" when config file omits it', () => {
    const config = loadConfig({ configPath: tmpConfigPath, env: VALID_ENV });
    expect(config.anthropicModel).toBe('claude-haiku-4-5');
  });

  it('returns the file value when anthropicModel is present in config file', () => {
    const configWithModel = { ...VALID_CONFIG, anthropicModel: 'claude-opus-4-5' };
    writeFileSync(tmpConfigPath, JSON.stringify(configWithModel));
    const config = loadConfig({ configPath: tmpConfigPath, env: VALID_ENV });
    expect(config.anthropicModel).toBe('claude-opus-4-5');
  });

  it('anthropicModel is NOT read from env — env setting has no effect', () => {
    const envWithModel: NodeJS.ProcessEnv = { ...VALID_ENV, ANTHROPIC_MODEL: 'from-env' };
    const config = loadConfig({ configPath: tmpConfigPath, env: envWithModel });
    expect(config.anthropicModel).toBe('claude-haiku-4-5');
  });
});
