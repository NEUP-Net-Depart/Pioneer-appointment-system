import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { wrangler } from './cli.mjs';
import { seed } from './seed.mjs';
const contents = [
  `JWT_SECRET=${randomBytes(48).toString('base64url')}`,
  `PII_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
  `ROOT001_PASSWORD=${randomBytes(24).toString('base64url')}`,
  `ROOT002_PASSWORD=${randomBytes(24).toString('base64url')}`
].join('\n') + '\n';
try { await writeFile(new URL('../.dev.vars', import.meta.url), contents, { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
wrangler(['d1','migrations','apply','DB','--local']);
await seed();
console.log('Local D1 ready. Root passwords are in ignored .dev.vars. Run npm run dev.');
