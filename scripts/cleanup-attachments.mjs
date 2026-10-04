import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachmentRepository } from '../src/db/attachments.js';
import { remoteConfig, wrangler } from './cli.mjs';
import { cloudflareClient } from './cloudflare-d1.mjs';

// Fixed cutoffs and an ID cursor let a failed row be retried next run without
// preventing the rest of this run from progressing. No D1/R2 writes in dry-run.
export async function cleanupAttachments(repository, deleteObject, {
  apply = false, now = new Date().toISOString(),
  onError = id => console.error('Attachment cleanup failed; retained quota', id)
} = {}) {
  const pendingBefore = new Date(Date.parse(now) - 86400000).toISOString();
  const result = { scanned: 0, deleted: 0, failed: 0, dryRun: !apply };
  let cursor = '';
  for (;;) {
    const items = await repository.cleanupCandidates(now, pendingBefore, cursor, 100);
    if (!items.length) break;
    for (const item of items) {
      result.scanned++;
      if (!apply) continue;
      try {
        if (!await repository.claimCleanup(item.id, now, pendingBefore)) continue;
        await deleteObject(item.objectKey);
        await repository.release(item.id);
        result.deleted++;
      } catch { result.failed++; onError(item.id); }
    }
    cursor = items.at(-1).id;
  }
  return result;
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--apply','--dry-run','--preview'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) throw new Error('Use --dry-run or --apply, optionally with --preview');
  const preview = args.includes('--preview'), apply = args.includes('--apply');
  const cfg = await remoteConfig(preview);
  const bindings = preview ? cfg.env.preview : cfg;
  const client = cloudflareClient(process.env.CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN);
  const bucket = bindings.r2_buckets.find(item => item.binding === 'ATTACHMENTS').bucket_name;
  // A nonexistent bucket must not be mistaken for individual expired objects.
  await client.checkBucket(bucket);
  const repository = attachmentRepository(client.database(bindings.d1_databases.find(item => item.binding === 'DB').database_id));
  const result = await cleanupAttachments(repository, async key => {
    wrangler(['r2','object','delete',`${bucket}/${key}`,'--remote', ...(preview ? ['--env','preview'] : [])], { capture: true });
  }, { apply });
  console.log(JSON.stringify({ environment: preview ? 'preview' : 'production', ...result }));
  if (result.failed) process.exitCode = 1;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
