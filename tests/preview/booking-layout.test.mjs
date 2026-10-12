import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';

test('local debugger updates layout and availability without reloading the booking document', { timeout: 30000 }, async () => {
  const server = spawn(process.execPath, ['scripts/preview-booking-layout.mjs'], {
    env: { ...process.env, BOOKING_LAYOUT_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let browser;
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview server did not start')), 10000);
      server.stdout.once('data', data => { clearTimeout(timeout); resolve(data.toString().match(/http:\/\/127\.0\.0\.1:\d+\//)[0]); });
      server.once('error', error => { clearTimeout(timeout); reject(error); });
      server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Preview server exited: ${code}`)); });
    });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await expect(page.locator('#update-status')).toHaveText('配置已实时应用');
    const preview = page.frameLocator('#preview');
    const firstDate = preview.locator('[data-date="2026-10-12"]');
    const firstSlot = preview.locator('[data-slot="19:00–20:00"]');
    await firstDate.click();
    await firstSlot.click();
    await preview.locator('[name=name]').fill('实时预览测试');
    const frame = page.frames().find(frame => frame.url().includes('/scenario/'));
    await frame.evaluate(() => { globalThis.__documentBeforeConfig = globalThis.document; });
    let navigations = 0;
    page.on('framenavigated', changed => { if (changed === frame) navigations++; });

    await page.locator('#device').selectOption('1280,720');
    assert.deepEqual(await frame.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight]), [1280, 720]);
    const desktopRows = await preview.locator('#booking-slots button').evaluateAll(buttons => buttons.map(button => {
      const { x, y, width } = button.getBoundingClientRect();
      return { x, y, width, parentWidth: button.parentElement.getBoundingClientRect().width };
    }));
    assert.equal(desktopRows[0].x, desktopRows[1].x);
    assert.ok(desktopRows[1].y > desktopRows[0].y);
    assert.equal(desktopRows[0].width, desktopRows[0].parentWidth);
    assert.ok(desktopRows[0].width <= 760);
    const desktopDetail = await firstSlot.evaluate(button => {
      const heading = button.querySelector('strong').getBoundingClientRect();
      const detail = button.querySelector('small').getBoundingClientRect();
      return { gap: detail.left - heading.right, fontSize: globalThis.getComputedStyle(button.querySelector('small')).fontSize };
    });
    assert.ok(desktopDetail.gap <= 24);
    assert.equal(desktopDetail.fontSize, '13px');
    await page.screenshot({ path: 'output/playwright/desktop-slot-rows.png', fullPage: true });
    await page.locator('#width').fill('375');
    await page.locator('#height').fill('667');
    assert.deepEqual(await frame.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight]), [375, 667]);
    await page.locator('#capacity-date').selectOption('2026-10-12');
    const textPositions = async locator => locator.evaluate(element => {
      const texts = [...element.childNodes].filter(node => node.nodeType === globalThis.Node.TEXT_NODE);
      const origin = element.getBoundingClientRect();
      return texts.map(node => {
        const range = globalThis.document.createRange(); range.selectNodeContents(node);
        const { x, y, width } = range.getBoundingClientRect();
        return { x: x - origin.x, y: y - origin.y, width };
      });
    });
    for (const device of ['1280,720', '375,667']) {
      await page.locator('#device').selectOption(device);
      await page.locator('#capacity-rows [data-field=remaining]').first().fill('10');
      await page.locator('#capacity-rows [data-field=remaining]').nth(1).fill('0');
      await expect(firstSlot).toContainText('剩余 10 名');
      assert.equal(await firstSlot.locator('.booking-remaining').evaluate(element => globalThis.getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
      await expect(firstDate).toContainText('剩余 10 名');
      const labels = [firstDate.locator('.booking-remaining'), firstSlot.locator('.booking-remaining')];
      const before = await Promise.all(labels.map(textPositions));
      await page.locator('#capacity-rows [data-field=remaining]').first().fill('9');
      await expect(firstSlot).toContainText('剩余 9 名');
      await expect(firstDate).toContainText('剩余 9 名');
      const after = await Promise.all(labels.map(textPositions));
      assert.deepEqual(after, before, 'The prefix and 名 suffix stay fixed while 10 rolls down to 9');
    }
    await page.locator('#reset-capacity').click();
    await expect(firstDate).toContainText('剩余 17 名');
    await page.locator('#capacity-rows [data-field=remaining]').first().fill('3');
    await expect(firstSlot).toContainText('剩余 3 名');
    await expect(preview.locator('[name=timeSlot]')).toHaveValue('19:00–20:00');
    await expect(firstDate).toContainText('剩余 11 名');
    await expect(preview.locator('[data-date="2026-10-13"]')).toContainText('剩余 17 名');
    await page.locator('#capacity-rows [data-field=remaining]').first().fill('0');
    await expect(firstSlot).toBeDisabled();
    assert.equal(await firstSlot.locator('.booking-remaining').evaluate(element => globalThis.getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    await expect(preview.locator('[name=timeSlot]')).toHaveValue('');
    await page.locator('#capacity-rows [data-field=capacity]').nth(1).fill('0');
    await expect(firstDate).toBeDisabled();
    await expect(preview.locator('[data-slot="20:00–21:00"]')).toContainText('暂停预约');
    assert.equal(await preview.locator('[data-slot="20:00–21:00"] .booking-remaining').evaluate(element => globalThis.getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.locator('#reset-capacity').click();
    await expect(firstDate).toBeEnabled();

    await page.locator('#capacity-campus').selectOption('浑南');
    await page.locator('#capacity-rows [data-field=remaining]').first().fill('1');
    await preview.locator('[data-campus="浑南"]').click();
    await expect(firstSlot).toContainText('剩余 1 名');
    await page.locator('#slots').selectOption('4');
    await expect(preview.locator('#booking-slots button')).toHaveCount(4);
    await page.locator('#device').selectOption('1440,900');
    await preview.locator('#booking-days button').first().click();
    await expect(preview.locator('#booking-slots button').first()).toBeEnabled();
    const desktopPanels = await preview.locator('.booking-picker-body').evaluate(body => {
      const dates = body.querySelector('.booking-date-panel').getBoundingClientRect();
      const times = body.querySelector('.booking-time-panel').getBoundingClientRect();
      return { datesRight: dates.right, timesLeft: times.left, rows: new Set([...body.querySelectorAll('#booking-slots button')].map(button => button.getBoundingClientRect().top)).size };
    });
    assert.ok(desktopPanels.datesRight < desktopPanels.timesLeft);
    assert.equal(desktopPanels.rows, 4);
    await preview.locator('#booking-picker').screenshot({ path: 'output/playwright/refined-desktop-four.png' });
    for (const width of ['1024,768', '1440,900']) {
      await page.locator('#device').selectOption(width);
      for (const slots of ['2', '4']) {
        await page.locator('#slots').selectOption(slots);
        for (const days of ['1', '2', '3', '4']) {
          await page.locator('#days').selectOption(days);
          await expect(preview.locator('#booking-days button')).toHaveCount(Number(days));
          await preview.locator('#booking-days button').first().click();
          await expect(preview.locator('#booking-picker')).toHaveAttribute('aria-busy', 'false');
          const geometry = await preview.locator('.booking-picker-body').evaluate(body => {
            const boxes = ['.booking-date-panel', '.booking-time-panel', '#booking-days', '#booking-slots', '.booking-date-panel .booking-panel-heading', '.booking-time-panel .booking-slot-panel .booking-panel-heading'].map(selector => {
              const { width, height, top, bottom } = body.querySelector(selector).getBoundingClientRect();
              return { width, height, top, bottom };
            });
            return { boxes, overflow: body.scrollWidth > body.clientWidth };
          });
          const [left, right, dates, times, leftTitle, rightTitle] = geometry.boxes;
          for (const [a, b] of [[left.width, right.width], [left.height, right.height], [dates.top, times.top], [dates.bottom, times.bottom], [leftTitle.top, rightTitle.top]]) assert.ok(Math.abs(a - b) < 1, 'Desktop panels, headings and choices should align');
          assert.equal(geometry.overflow, false);
          {
            const hitTargets = await preview.locator('#booking-days button').evaluateAll(buttons => buttons.map(button => {
              return ['strong', 'small'].every(selector => {
                const text = button.querySelector(selector).getBoundingClientRect();
                return [[.1, .1], [.9, .1], [.1, .9], [.9, .9]].every(([x, y]) =>
                  globalThis.document.elementFromPoint(text.x + text.width * x, text.y + text.height * y)?.closest('button') === button);
              });
            }));
            assert.ok(hitTargets.every(Boolean), 'Every shaped date has an unobstructed click target at its label');
            for (const button of await preview.locator('#booking-days button').all()) {
              await button.click();
              await expect(button).toHaveAttribute('aria-pressed', 'true');
              await expect(preview.locator('#booking-picker')).toHaveAttribute('aria-busy', 'false');
            }
          }
          if (width === '1440,900' && slots === '4') await preview.locator('#booking-picker').screenshot({ path: `output/playwright/balanced-desktop-${days}-days.png`, animations: 'disabled' });
          if (width === '1024,768' && slots === '4') await preview.locator('#booking-picker').screenshot({ path: `output/playwright/shaped-narrow-desktop-${days}-days.png`, animations: 'disabled' });
        }
      }
    }
    await page.locator('#slots').selectOption('2');
    await page.locator('#capacity-campus').selectOption('浑南');
    for (const [scenario, dates] of [
      ['friday', ['2026-10-19']],
      ['saturday', ['2026-10-19', '2026-10-20']],
      ['sunday', ['2026-10-19', '2026-10-20', '2026-10-21']]
    ]) {
      await page.locator('#days').selectOption(scenario);
      await expect(page.locator('#update-status')).toHaveText('配置已实时应用');
      assert.deepEqual(await preview.locator('#booking-days button').evaluateAll(buttons => buttons.map(button => button.dataset.date)), dates);
      assert.deepEqual(await page.locator('#capacity-date option').evaluateAll(options => options.map(option => option.value)), ['*', ...dates]);
      const monday = preview.locator('[data-date="2026-10-19"]');
      if (scenario === 'friday') {
        await monday.click();
        await firstSlot.click();
        await expect(preview.locator('[name=timeSlot]')).toHaveValue('19:00–20:00');
        await page.locator('#capacity-date').selectOption('2026-10-19');
        await page.locator('#capacity-rows [data-field=remaining]').first().fill('2');
      }
      await expect(firstSlot).toContainText('剩余 2 名');
      await expect(preview.locator('[name=date]')).toHaveValue('2026-10-19');
      await expect(preview.locator('[name=timeSlot]')).toHaveValue('19:00–20:00');
      await expect(monday).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#capacity-date')).toHaveValue('2026-10-19');
    }
    await expect(preview.locator('[name=name]')).toHaveValue('实时预览测试');
    await page.locator('#device').selectOption('375,667');
    await preview.locator('#booking-days button').first().click();
    await expect(preview.locator('#booking-slots button').first()).toBeEnabled();
    await preview.locator('#booking-picker').screenshot({ path: 'output/playwright/refined-mobile-four.png' });
    assert.equal(await frame.evaluate(() => globalThis.__documentBeforeConfig === globalThis.document), true);
    assert.equal(navigations, 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: 'output/playwright/live-layout-debugger.png', fullPage: true });
    const selectedColors = new Set();
    for (const device of ['1440,900', '375,667']) {
      for (const slotCount of ['2', '4']) {
        for (const days of ['1', '2', '3', '4']) {
          await page.goto(url);
          await expect(page.locator('#update-status')).toHaveText('配置已实时应用');
          await page.locator('#device').selectOption(device);
          await page.locator('#slots').selectOption(slotCount);
          await page.locator('#days').selectOption(days);
          await expect(page.locator('#update-status')).toHaveText('配置已实时应用');
          await expect(preview.locator('#booking-picker')).toHaveAttribute('aria-busy', 'false');
          const before = await preview.locator('#booking-picker').boundingBox();
          await preview.locator('#booking-days button').first().click();
          await expect(preview.locator('#booking-picker')).toHaveAttribute('aria-busy', 'false');
          const after = await preview.locator('#booking-picker').boundingBox();
          assert.ok(Math.abs(before.height - after.height) < 1, `${device}, ${days} days, ${slotCount} slots: selecting a date must not resize the picker (${before.height} → ${after.height})`);
          const color = await preview.locator('#booking-days [aria-pressed=true]').evaluate(async button => {
            await Promise.all(button.getAnimations().map(animation => animation.finished.catch(() => {})));
            return globalThis.getComputedStyle(button).backgroundColor;
          });
          selectedColors.add(color);
        }
      }
    }
    assert.equal(selectedColors.size, 1, 'Desktop and phone dates use the same selected background');
  } finally {
    await browser?.close();
    server.kill();
  }
});
