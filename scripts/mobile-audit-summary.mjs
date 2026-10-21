import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'output/mobile-audit');
async function walk(path) {
  return (await Promise.all((await readdir(path, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(resolve(path, entry.name)) : resolve(path, entry.name)))).flat();
}
const files = await walk(resolve(directory, 'evidence'));
const observations = await Promise.all(files.filter(file => file.endsWith('/observations.json')).map(async file => ({ path: relative(directory, file), ...JSON.parse(await readFile(file, 'utf8')) })));
const inventory = JSON.parse(await readFile(resolve(directory, 'inventory.json'), 'utf8'));
const projects = [...new Set(observations.map(row => row.project))].sort();
const samples = observations.flatMap(row => row.samples.map(sample => ({ project: row.project, test: row.test, path: row.path, ...sample })));
const violations = samples.flatMap(sample => (sample.axe || []).map(violation => ({ project: sample.project, test: sample.test, sample: sample.id, rule: violation.id, impact: violation.impact, count: violation.nodes.length, path: sample.path })));
const businessScenarios = [
  'backoffice-real-member-activation-role-save-and-error-page',
  'configuration-previews-discard-and-affected-order-navigation',
  'camera-fallback-switch-release-and-password-change',
  'lead-real-transfer-correction-history',
  'admin-real-office-roster-availability-publish',
  'admin-members-accounts-attendance-export-dialogs',
  'public-entry-and-activation',
  'student-real-booking-upload-query-cancel',
  'technician-real-signin-search-intake-finish-permission',
  'office-real-registration-and-lead-management',
  'repair-roster-real-generate-adjust-publish',
  'swap-real-preview-send-accept-history',
].filter(name => observations.some(row => row.test === name));
const summary = {
  projects, browserVersions: Object.fromEntries(observations.map(row => [row.project, row.diagnostics.browserVersion])),
  tests: { total: observations.length, passed: observations.filter(row => row.status === 'passed').length, failed: observations.filter(row => row.status === 'failed').length, skipped: observations.filter(row => row.status === 'skipped').length },
  scenarios: [...new Set(observations.map(row => row.test))], businessScenarios, businessScenarioCount: businessScenarios.length, sampleCount: samples.length, screenshotCount: files.filter(file => /\.jpg$/.test(file)).length,
  coverage: inventory.pages.map(page => ({ ...page, projects: projects.map(project => { const sample = samples.find(row => row.project === project && row.id === page.id.replace(':', '-')); return { project, observed: !!sample, evidence: sample?.path }; }) })),
  failures: observations.filter(row => row.status === 'failed').map(row => ({ project: row.project, test: row.test, evidence: row.path })),
  overflow: samples.filter(row => row.documentWidth > row.viewport.width + 1).map(row => ({ project: row.project, test: row.test, sample: row.id, viewport: row.viewport, width: row.documentWidth, nodes: row.overflowNodes, path: row.path })),
  clipped: samples.filter(row => row.clipped.length).map(row => ({ project: row.project, sample: row.id, nodes: row.clipped, path: row.path })),
  accessibility: { scans: samples.filter(row => row.axe).length, violations },
  pageErrors: observations.filter(row => row.diagnostics.pageErrors.length).map(row => ({ project: row.project, test: row.test, errors: row.diagnostics.pageErrors })),
  smallTargetSamples: samples.filter(row => row.smallTargets.length).map(row => ({ project: row.project, sample: row.id, count: row.smallTargets.length, path: row.path })),
  smallInputSamples: samples.filter(row => row.smallInputs.length).map(row => ({ project: row.project, sample: row.id, count: row.smallInputs.length, path: row.path })),
};
const labels = { 'student-step-1': '学生预约：校区与时间', 'student-step-2': '学生预约：设备与联系', 'student-step-3': '学生预约：核对与签名', 'success-panel': '学生预约成功', 'lookup-list': '我的预约', 'lookup-detail': '预约详情' };
let index = '# 移动端审查页面截图索引\n\nC = Chromium，W = WebKit，F = Firefox。这里展示主要页面的普通字号截图；同目录 observations.json 保留 200% 字体、弹窗和其他状态测量。全量结果参见 [summary.json](summary.json)。\n\n| 页面／工作区 | 360 × 800 | 393 × 873 | 430 × 932 | 768 × 1024 | 1440 × 900 |\n| --- | --- | --- | --- | --- | --- |\n';
for (const page of inventory.pages) {
  const cells = [360, 393, 430, 768, 1440].map(width => ['chromium', 'webkit', 'firefox'].map((browser, i) => {
    const sample = samples.find(row => row.project === `${browser}-${width}` && row.id === page.id.replace(':', '-'));
    if (!sample) return `${['C', 'W', 'F'][i]} 未验证`;
    return `[${['C', 'W', 'F'][i]}](${sample.path.replace('observations.json', `${sample.id}.jpg`)})`;
  }).join(' · '));
  index += `| ${labels[page.id] || page.label} | ${cells.join(' | ')} |\n`;
}
await writeFile(resolve(directory, 'evidence-index.md'), index);
// A successful rerun supersedes its earlier failure image; original traces remain in ignored output/.
for (const row of observations.filter(row => row.status === 'passed')) await rm(resolve(directory, row.path.replace('observations.json', 'failure.jpg')), { force: true });
await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ projects: projects.length, tests: summary.tests, scenarios: summary.scenarios.length, samples: summary.sampleCount, screenshots: summary.screenshotCount, pages: summary.coverage.length, observedPages: summary.coverage.filter(row => row.projects.every(project => project.observed)).length, overflows: summary.overflow.length, axeScans: summary.accessibility.scans, pageErrors: summary.pageErrors.length }));
