import { Command } from 'commander';
import { registerIngest } from './ingest.js';
import { registerList } from './list.js';
import { registerExport } from './export.js';
import { registerAuth } from './auth.js';

export function buildProgram(): Command {
  const program = new Command();
  program.name('hire-radar').description('Job-vacancy ingestion CLI for the Uzbekistan market');
  registerIngest(program);
  registerList(program);
  registerExport(program);
  registerAuth(program);
  return program;
}
