import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appointmentRepository } from '../src/db/appointments.js';
import { remoteConfig } from './cli.mjs';
import { cloudflareClient } from './cloudflare-d1.mjs';

export async function expireAppointments(repository, { apply = false, now = new Date() } = {}) {
  const instant = now.toISOString();
  if (!apply) return { dryRun: true, eligible: await repository.countExpirations(instant), ended: 0 };
  const result = await repository.expirePending(instant);
  return { dryRun: false, ended: result.meta.changes };
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--apply','--dry-run','--preview'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) throw new Error('Use --dry-run or --apply, optionally with --preview');
  const preview = args.includes('--preview'), cfg = await remoteConfig();
  const bindings = preview ? cfg.env.preview : cfg;
  const client = cloudflareClient(process.env.CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN);
  const repository = appointmentRepository(client.database(bindings.d1_databases.find(item => item.binding === 'DB').database_id));
  const result = await expireAppointments(repository, { apply: args.includes('--apply') });
  console.log(JSON.stringify({ environment: preview ? 'preview' : 'production', ...result }));
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
