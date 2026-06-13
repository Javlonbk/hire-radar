import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'bin', 'hire-radar');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

describe('bin/hire-radar error handling', () => {
  it('surfaces loadConfig clean message (no stack trace) and exits non-zero', () => {
    const res = spawnSync(tsx, [bin, 'ingest'], { cwd: root, encoding: 'utf8' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/Cannot read config file/);
    expect(res.stderr).not.toMatch(/\n\s+at /);
  });
});
