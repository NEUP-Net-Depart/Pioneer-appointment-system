import { remoteConfig, wrangler } from './cli.mjs';
const preview = process.argv.includes('--preview');
const cfg = await remoteConfig(preview);
await import('./build.mjs');
wrangler(['d1','migrations','apply','DB','--remote', ...(preview ? ['--env','preview'] : [])]);
wrangler(['pages','deploy','dist','--project-name',cfg.name,'--branch',preview ? 'preview' : 'main']);
