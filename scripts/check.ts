import { wrangler, config } from './cli.ts';

// ESLint and TypeScript own syntax checks; validate the actual Pages bundle here.
const cfg = await config();
wrangler([
  'pages',
  'functions',
  'build',
  'functions',
  '--outdir',
  '.wrangler/build',
  '--compatibility-date',
  cfg.compatibility_date,
  '--compatibility-flags',
  ...cfg.compatibility_flags
]);
