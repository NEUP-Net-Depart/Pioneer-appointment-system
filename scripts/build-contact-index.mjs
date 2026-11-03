import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appointmentRepository } from '../src/db/appointments.js';
import { readStoredContact, contactSearchTokens } from '../src/lib/privacy.js';
import { remoteConfig } from './cli.mjs';
import { cloudflareClient } from './cloudflare-d1.mjs';

export function requireContactIndexKey(key = process.env.PII_ENCRYPTION_KEY) {
  if (typeof key !== 'string' || !/^[a-f\d]{64}$/i.test(key))
    throw new Error('Set PII_ENCRYPTION_KEY to the target environment\'s existing 64-character hex key.');
  return key;
}

export async function buildContactIndex(db, { apply = false, encryptionKey, onBatch = () => {} } = {}) {
  const countPending = async () => Number((await db.prepare('SELECT COUNT(*) AS n FROM appointment_contact_index_pending').first()).n);
  let pending = await countPending(), processed = 0;
  if (!apply) return { dryRun: true, processed, pending };
  encryptionKey = requireContactIndexKey(encryptionKey);
  if (pending) {
    // Check an encrypted value before writing any batch, including legacy plaintext rows.
    const sample = await db.prepare(`SELECT phone,email,contact_value,social FROM appointments
      WHERE phone LIKE 'enc$%' OR email LIKE 'enc$%' OR contact_value LIKE 'enc$%' OR social LIKE 'enc$%'
      LIMIT 1`).first();
    if (sample) await readStoredContact(Object.values(sample).find(value => value?.startsWith('enc$')), encryptionKey);
  }
  const repository = appointmentRepository(db);
  while (pending) {
    const started = performance.now();
    const { results: rows } = await db.prepare(`SELECT a.id,p.generation,a.phone,a.email,a.contact_value,a.social
      FROM appointment_contact_index_pending p JOIN appointments a ON a.id=p.appointment_id
      ORDER BY p.appointment_id LIMIT 500`).all();
    if (!rows.length) throw new Error('Pending contact index records could not be read.');
    const tokens = [];
    for (const row of rows) {
      const values = await Promise.all([row.phone, row.email, row.contact_value, row.social]
        .map(value => readStoredContact(value, encryptionKey)));
      tokens.push({ id: row.id, generation: row.generation,
        tokens: await contactSearchTokens(values, encryptionKey) });
    }
    // Generation checks retain rows changed during calculation for the next batch.
    await repository.indexContacts(tokens);
    processed += rows.length;
    pending = await countPending();
    onBatch({ batchSize: rows.length, processed, pending, elapsedMs: Math.round(performance.now() - started) });
  }
  return { dryRun: false, processed, pending };
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--apply', '--dry-run', '--preview'].includes(arg)) || new Set(args).size !== args.length || (args.includes('--apply') && args.includes('--dry-run')))
    throw new Error('Use --dry-run or --apply, optionally with --preview.');
  const preview = args.includes('--preview'), apply = args.includes('--apply');
  const encryptionKey = apply ? requireContactIndexKey() : undefined;
  const cfg = await remoteConfig(), bindings = preview ? cfg.env.preview : cfg;
  const client = cloudflareClient(process.env.CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN);
  const db = client.database(bindings.d1_databases.find(item => item.binding === 'DB').database_id);
  const environment = preview ? 'preview' : 'production';
  const result = await buildContactIndex(db, { apply, encryptionKey,
    onBatch: progress => console.log(JSON.stringify({ operation: 'build-contact-index', environment, ...progress })) });
  console.log(JSON.stringify({ operation: 'build-contact-index', environment, ...result }));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
