import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockStaff, loginStaff, staffPage } from './support/staff.mjs';
import { setupStudent } from './support/student.mjs';

const motion = (await readFile(new URL('../../shared/data-motion.js', import.meta.url), 'utf8')).replace('export const dataMotionPresets', 'const dataMotionPresets').replace('export function observeDataMotion', 'window.observeDataMotion = function');
for (const width of [320, 390, 768, 1440]) test(`data regions extend locally without moving the heading at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}.field-appointments{padding:16px;border:1px solid;max-width:700px}.row{height:50px}h1{margin:0;height:60px}</style><main><h1>工作台</h1><section class="field-appointments"><div id="a" class="row" data-motion-item="a">张三</div><div id="b" class="row" data-motion-item="b">李四</div></section></main>`);
  await page.addScriptTag({ content: motion });
  await page.evaluate(() => { window.stopMotion = window.observeDataMotion(document.querySelector('main')); });
  const initial = await page.locator('h1').boundingBox();
  const result = await page.evaluate(async () => {
    const region = document.querySelector('.field-appointments');
    const before = region.getBoundingClientRect().height;
    region.append(Object.assign(document.createElement('div'), { className: 'row', textContent: '王五' }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { before, current: region.getBoundingClientRect().height, animations: region.getAnimations().length };
  });
  expect(result.animations).toBe(1);
  expect(result.current).toBeLessThan(result.before + 50);
  await expect.poll(() => page.locator('.field-appointments').evaluate(node => node.getAnimations().length)).toBe(0);
  expect((await page.locator('.field-appointments').boundingBox()).height).toBe(result.before + 50);
  expect(await page.locator('h1').boundingBox()).toEqual(initial);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => {
    const region = document.querySelector('.field-appointments');
    region.prepend(document.querySelector('#b'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.reordering = document.querySelector('#a').getAnimations().length;
  });
  expect(await page.evaluate(() => window.reordering)).toBe(1);
  await page.evaluate(() => window.stopMotion());
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('focused input, reduced motion and hidden document never animate data updates', async ({ page }) => {
  await page.setContent('<main><section class="field-appointments"><input aria-label="姓名"><div data-motion-item="a">张三</div></section></main>');
  await page.addScriptTag({ content: motion });
  await page.evaluate(() => { window.stopMotion = window.observeDataMotion(document.querySelector('main')); });
  await page.getByRole('textbox').fill('正在填写');
  await page.evaluate(async () => {
    document.querySelector('.field-appointments').append(Object.assign(document.createElement('p'), { textContent: '新增成员' }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.locator('.field-appointments').evaluate(node => node.getAnimations().length)).toBe(0);
  await expect(page.getByRole('textbox')).toBeFocused();
  await expect(page.getByRole('textbox')).toHaveValue('正在填写');
  await page.getByRole('textbox').blur();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async () => {
    document.querySelector('.field-appointments').append(Object.assign(document.createElement('p'), { textContent: '减少动效' }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.querySelector('.field-appointments').append(Object.assign(document.createElement('p'), { textContent: '后台更新' }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('record refresh retains rows, pagination, focus and scroll until the response arrives', async ({ page }) => {
  await mockStaff(page);
  let release, delayed = false;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/appointments?*', async route => {
    if (delayed) await pending;
    await route.fulfill({ json: { items: [{ id: 'reserve020261024-01', name: '测试客户', date: '2026-10-24', timeSlot: '14:00-14:30', status: 'booked', campus: '南湖', deviceModel: 'ThinkPad' }], nextCursor: 'next' } });
  });
  try {
    await loginStaff(page);
    await staffPage(page, '预约记录');
    const more = page.getByRole('button', { name: '加载更多预约' });
    await expect(more).toBeVisible();
    delayed = true;
    await page.getByRole('button', { name: '刷新记录', exact: true }).click();
    await expect(more).toBeVisible();
    await expect(more).toBeDisabled();
    await expect(page.locator('.records-table tbody')).toContainText('测试客户');
    const search = page.getByPlaceholder('预约编号、历史维修编号、姓名或学号');
    await search.focus();
    const scroll = await page.evaluate(() => scrollY);
    release();
    await expect(more).toBeEnabled();
    await expect(search).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('roster does not flash an empty task invitation while the task list is pending', async ({ page }) => {
  const session = await mockStaff(page);
  session.profile.permissions['roster.repair.manage'] = true;
  session.home.permissions['roster.repair.manage'] = true;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/roster-tasks', async route => { await pending; await route.fulfill({ json: { items: [] } }); });
  try {
    await loginStaff(page);
    await staffPage(page, '维修排班管理');
    await expect(page.getByLabel('本周收集与排班')).toBeVisible();
    await expect(page.locator('.roster-start')).toHaveCount(0);
    release();
    await expect(page.locator('.roster-start')).toBeVisible();
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});


test('rapid region updates settle at natural height and viewport resizing cancels motion', async ({ page }) => {
  await page.setContent('<main><section class="field-appointments" style="padding:16px;border:1px solid"><p>初始内容</p></section></main>');
  await page.addScriptTag({ content: motion });
  await page.evaluate(() => { window.stopMotion = window.observeDataMotion(document.querySelector('main')); });
  const height = await page.evaluate(async () => {
    const region = document.querySelector('.field-appointments');
    for (let i=0;i<4;i++) {
      region.append(Object.assign(document.createElement('p'), { textContent: `连续更新 ${i}` }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const natural = region.cloneNode(true);
    natural.style.width = getComputedStyle(region).width;
    natural.style.position = 'absolute';
    document.body.append(natural);
    const height = natural.clientHeight;
    natural.remove();
    return height;
  });
  await expect.poll(() => page.locator('.field-appointments').evaluate(node => node.getAnimations().length)).toBe(0);
  expect(await page.locator('.field-appointments').evaluate(node => node.clientHeight)).toBe(height);
  await page.evaluate(async () => {
    document.querySelector('.field-appointments').append(Object.assign(document.createElement('p'), { textContent: '最后一次' }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.dispatchEvent(new Event('resize'));
  });
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});


test('student record polling keeps unaffected cards and keyboard focus', async ({ page }) => {
  const state = await setupStudent(page);
  const items = [1,2].map(index => ({ id: `reserve020261012-0${index}`, accessToken: 'a'.repeat(43), revision: 0, status: 'booked', date: '2026-10-12', timeSlot: '19:00–19:30', campus: '南湖', deviceType: '笔记本', brand: `测试设备${index}`, faultType: '蓝屏', attachments: [] }));
  items.forEach(item => state.appointments.set(item.id, item));
  await page.evaluate(items => localStorage.setItem('pioneerAppointmentAccess', JSON.stringify(items.map(({id,accessToken}) => ({id,accessToken})))), items);
  await page.locator('[data-view-link=lookup]').first().click();
  await expect(page.locator('.student-record')).toHaveCount(2);
  items[1].faultType = '无法开机'; items[1].revision++;
  await page.evaluate(() => {
    window.originalCard = document.querySelector('.student-record');
    document.querySelector('#refresh-my-appointments').click();
    window.originalCard.focus();
  });
  await expect(page.locator('#lookup-results')).toContainText('无法开机');
  expect(await page.evaluate(() => window.originalCard === document.querySelector('.student-record'))).toBe(true);
  expect(await page.evaluate(() => document.activeElement === window.originalCard)).toBe(true);
});


test('signature and camera regions retain their geometry instead of animating their container', async ({ page }) => {
  await page.setContent('<main><section class="workspace-dialog-body"><p>设备核验</p></section></main>');
  await page.addScriptTag({ content: motion });
  await page.evaluate(() => { window.stopMotion = window.observeDataMotion(document.querySelector('main')); });
  await page.evaluate(async () => {
    document.querySelector('.workspace-dialog-body').append(document.createElement('canvas'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});


test('semantic motion presets distinguish text, numbers, status and arriving rows without replaying unchanged values', async ({ page }) => {
  await page.setContent('<style>[data-motion-value]{display:inline-block}</style><main><section data-motion-region><span id="text" data-motion-value="text" aria-busy="true">—</span><span id="number" data-motion-value="number">3</span><span id="status" data-motion-value="status">空闲</span><input id="field" data-motion-value="field" value="旧值"></section></main>');
  await page.addScriptTag({ content: motion });
  await page.evaluate(() => { window.stopMotion = window.observeDataMotion(document.querySelector('main')); });
  const result = await page.evaluate(async () => {
    const text = document.querySelector('#text');
    text.textContent = '读取完成'; text.setAttribute('aria-busy', 'false');
    document.querySelector('#number').textContent = '7';
    document.querySelector('#status').textContent = '维修中';
    const row = document.createElement('p'); row.id = 'new-row'; row.dataset.motionItem = 'new'; row.textContent = '新增工单';
    document.querySelector('section').append(row);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Object.fromEntries(['text','number','status','new-row'].map(id => {
      const animation = document.getElementById(id).getAnimations()[0];
      return [id, { duration: animation?.effect.getTiming().duration, frames: animation?.effect.getKeyframes() }];
    }));
  });
  expect(result.text.duration).toBe(160);
  expect(result.number.duration).toBe(180);
  expect(result.status.duration).toBe(150);
  expect(result['new-row'].duration).toBe(180);
  expect(result.text.frames[0].opacity).toBe('0.65');
  expect(result.number.frames[0].transform).toContain('translateY');
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  const unchanged = await page.evaluate(async () => {
    document.querySelector('#text').firstChild.data = '读取完成';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.querySelector('#text').getAnimations().length;
  });
  expect(unchanged).toBe(0);
  await page.locator('#field').focus();
  const focused = await page.evaluate(async () => {
    document.querySelector('#field').setAttribute('value', '新值');
    document.querySelector('#text').textContent = '输入期间新数据';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.getAnimations().length;
  });
  expect(focused).toBe(0);
  await page.locator('#field').blur();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(async () => {
    document.querySelector('#text').textContent = '减少动态效果';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.getAnimations().length;
  });
  expect(reduced).toBe(0);
  await page.evaluate(() => window.stopMotion());
});
