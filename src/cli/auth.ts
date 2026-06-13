import { Command } from 'commander';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { createInterface } from 'node:readline/promises';

export type LoginFn = (creds: { apiId: number; apiHash: string }) => Promise<string>;

export interface AuthDeps {
  apiId?: number;
  apiHash?: string;
  login: LoginFn;
  out: (line: string) => void;
}

export function authCredsFromEnv(env: NodeJS.ProcessEnv): { apiId?: number; apiHash?: string } {
  const rawId = env['TELEGRAM_API_ID'];
  return { apiId: rawId ? Number(rawId) : undefined, apiHash: env['TELEGRAM_API_HASH'] };
}

export async function runAuth(deps: AuthDeps): Promise<void> {
  if (!deps.apiId || !deps.apiHash) {
    throw new Error('Missing TELEGRAM_API_ID / TELEGRAM_API_HASH — set them in your .env before running auth');
  }
  const session = await deps.login({ apiId: deps.apiId, apiHash: deps.apiHash });
  deps.out('');
  deps.out('Telegram session created. Store this as TELEGRAM_SESSION in your .env:');
  deps.out('');
  deps.out(session);
  deps.out('');
  deps.out('WARNING: this is a long-lived credential — never commit it. ingest reads it from TELEGRAM_SESSION.');
}

export const gramjsLogin: LoginFn = async ({ apiId, apiHash }) => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  await client.start({
    phoneNumber: async () => (await rl.question('Phone (+99890...): ')).trim(),
    phoneCode: async () => (await rl.question('Login code: ')).trim(),
    password: async () => (await rl.question('2FA password (blank if none): ')).trim(),
    onError: (e) => { process.stderr.write(String(e) + '\n'); },
  });
  rl.close();
  const session = String(client.session.save());
  await client.disconnect();
  return session;
};

export function registerAuth(program: Command): void {
  program
    .command('auth')
    .description('One-time interactive Telegram login; prints a session string to store as TELEGRAM_SESSION')
    .action(async () => {
      await runAuth({
        ...authCredsFromEnv(process.env),
        login: gramjsLogin,
        out: (l) => process.stdout.write(l + '\n'),
      });
    });
}
