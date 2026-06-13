import { z } from 'zod';
import { readFileSync } from 'node:fs';

const configSchema = z.object({
  anthropicApiKey: z.string().min(1),
  telegramApiId: z.coerce.number().int().positive().optional(),
  telegramApiHash: z.string().min(1).optional(),
  telegramSession: z.string().optional(),
  telegram: z.object({
    channels: z.array(z.string()),
  }),
  hh: z.object({
    area: z.string(),
    text: z.string(),
    perPage: z.number(),
  }),
  rss: z.object({
    feeds: z.array(z.string()),
  }),
  anthropicModel: z.string().min(1).default('claude-haiku-4-5'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(opts?: { configPath?: string; env?: NodeJS.ProcessEnv }): Config {
  const configPath = opts?.configPath ?? 'config.json';
  const env = opts?.env ?? process.env;

  let fileData: unknown;
  try {
    fileData = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Cannot read config file ${configPath} (copy config.example.json to get started): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof fileData !== 'object' || fileData === null) {
    throw new Error(`Config file ${configPath} must contain a JSON object`);
  }
  const file = fileData as Record<string, unknown>;

  const merged = {
    anthropicApiKey: env['ANTHROPIC_API_KEY'],
    telegramApiId: env['TELEGRAM_API_ID'],
    telegramApiHash: env['TELEGRAM_API_HASH'],
    telegramSession: env['TELEGRAM_SESSION'],
    telegram: file.telegram,
    hh: file.hh,
    rss: file.rss,
    anthropicModel: file.anthropicModel,
  };

  const ENV_VAR_NAMES: Record<string, string> = {
    anthropicApiKey: 'ANTHROPIC_API_KEY',
    telegramApiId: 'TELEGRAM_API_ID',
    telegramApiHash: 'TELEGRAM_API_HASH',
    telegramSession: 'TELEGRAM_SESSION',
  };

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    const first = result.error.issues[0];
    const fieldKey = String(first.path[0]);
    const envVar = ENV_VAR_NAMES[fieldKey];
    const displayName = envVar ?? first.path.join('.');
    const hint = envVar ? ' — set it in your .env file' : ` — check ${configPath}`;
    throw new Error(`Missing or invalid config: ${displayName}${hint}`);
  }

  return result.data;
}
