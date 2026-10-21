import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function walk(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(resolve(dir, entry.name)) : resolve(dir, entry.name)))).flat();
}
export async function inventory() {
  const pages = [], sections = [], dialogs = [], routeChecks = [];
  for (const file of await walk(resolve(root, 'frontend/staff-react'))) {
    if (!/\.[jt]sx?$/.test(file)) continue;
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\{\s*id:\s*['"]([^'"]*)['"]\s*,\s*label:\s*['"]([^'"]+)['"]/g)) {
      const row = { id: match[1], label: match[2], file: relative(root, file), line: text.slice(0, match.index).split('\n').length };
      if (file.endsWith('/main.jsx')) pages.push({ ...row, url: '/staff/', type: 'workspace' });
      else sections.push(row);
    }
    for (const match of text.matchAll(/<Modal\b[\s\S]*?title=("[^"]*"|\{[^}]*\})/g)) dialogs.push({ title: match[1], file: relative(root, file), line: text.slice(0, match.index).split('\n').length });
  }
  const html = await readFile(resolve(root, 'frontend/user/index.html'), 'utf8');
  for (const match of html.matchAll(/<section\b([^>]*\b(?:data-step="[^"]+"|id="(?:success-panel|lookup-list|lookup-detail)")[^>]*)>/g)) {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const id = attributes['data-step'] ? `student-step-${attributes['data-step']}` : attributes.id;
    pages.push({ id, label: id, url: '/', type: 'student-state', file: 'frontend/user/index.html', line: html.slice(0, match.index).split('\n').length });
  }
  for (const match of html.matchAll(/<section\b([^>]*role="dialog"[^>]*)>/g)) dialogs.push({ title: match[1], file: 'frontend/user/index.html', line: html.slice(0, match.index).split('\n').length });
  const accessSource = await readFile(resolve(root, 'frontend/staff-react/StaffAccess.jsx'), 'utf8');
  for (const [id, label, url, component] of [
    ['staff-login', '工作人员登录', '/staff/', 'StaffLogin'],
    ['staff-activation', '工作人员首次激活', '/staff/?activate=1', 'StaffActivation'],
  ]) {
    const start = accessSource.indexOf(`export function ${component}(`);
    if (start < 0) throw new Error(`Missing staff entry component: ${component}`);
    pages.push({ id, label, url, type: 'entry', file: 'frontend/staff-react/StaffAccess.jsx', line: accessSource.slice(0, start).split('\n').length });
  }
  pages.push({ id: 'not-found', label: '页面不存在', url: '/__mobile-audit-no-such-page__', type: 'error', file: 'public/404.html', line: 2 });
  // Field scenes come from server-published contexts rather than literal menu objects.
  const fieldFiles = (await walk(resolve(root, 'src'))).filter(file => /\.[jt]s$/.test(file));
  for (const file of fieldFiles) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\{\s*id:\s*['"](desk|repair|operations)['"]\s*,\s*label:\s*['"]([^'"]+)['"]/g)) {
      if (!pages.some(row => row.id === `scene:${match[1]}`)) pages.push({ id: `scene:${match[1]}`, label: match[2], url: '/staff/', type: 'workspace', file: relative(root, file), line: text.slice(0, match.index).split('\n').length });
    }
  }
  const access = await readFile(resolve(root, 'shared/staff-access.js'), 'utf8');
  for (const match of access.matchAll(/(?:'([^']+)'|([\w]+)):\s*'([^']+)'/g)) routeChecks.push({ view: match[1] || match[2], permission: match[3] });
  const moduleNavigation = [];
  for (const file of fieldFiles.filter(file => file.endsWith('/manifest.js'))) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/\{\s*id:\s*'([^']+)',\s*path:\s*'([^']+)',\s*title:\s*'([^']+)',\s*permission:\s*'([^']+)'/g)) moduleNavigation.push({ id: match[1], path: match[2], title: match[3], permission: match[4], releaseState: source.match(/releaseState:\s*'([^']+)'/)?.[1], file: relative(root, file), line: source.slice(0, match.index).split('\n').length });
  }
  return { generatedFrom: 'current working tree only; literal menu/section extraction + student HTML + server context + access map + module navigation manifests', pages, sections, dialogs, routeChecks, moduleNavigation };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await inventory();
  await mkdir(resolve(root, 'output/mobile-audit'), { recursive: true });
  await writeFile(resolve(root, 'output/mobile-audit/inventory.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ pages: result.pages.length, sections: result.sections.length, dialogs: result.dialogs.length, ids: result.pages.map(row => row.id) }));
}
