import { describe, it, expect } from 'vitest';
import { buildProgram } from './index.js';

describe('buildProgram', () => {
  it('registers ingest, list, export, auth subcommands', () => {
    const names = buildProgram().commands.map(c => c.name());
    expect(names).toEqual(expect.arrayContaining(['ingest', 'list', 'export', 'auth']));
  });
  it('names the program hire-radar', () => {
    expect(buildProgram().name()).toBe('hire-radar');
  });
});
