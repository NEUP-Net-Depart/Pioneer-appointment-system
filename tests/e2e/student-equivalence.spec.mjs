import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from './support/fixtures.mjs';
import { PHOTO, chooseTime, fillDevice, goReview, sign } from './support/student.mjs';
import { loginStaff, staffApi, staffPage } from './support/staff.mjs';

const baseline = process.env.E2E_STUDENT_BASELINE;
test.skip(!baseline, 'Run with npm run test:student-equivalence.');
test.use({ reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai', locale: 'zh-CN' });

async function capture(page, info, name) {
  const path = resolve(baseline, info.project.name, name + '.png');
  // Pin the pointer and viewport. Playwright's prior click can otherwise leave
  // a different off-screen control hovered after focus scrolls on mobile.
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    scrollTo({ top: 0, behavior: 'instant' });
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter(
          (image) =>
            image.getClientRects().length &&
            image.src &&
            (!image.complete || !image.src.startsWith('blob:'))
        )
        .map((image) => image.decode())
    );
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    // Repaint the unchanged presentation after the previous click's scroll
    // and compositing. Opacity preserves layout and keyboard focus.
    const opacity = document.body.style.opacity;
    document.body.style.opacity = '0';
    await frame();
    await frame();
    document.body.style.opacity = opacity;
    await frame();
    await frame();
  });
  let image;
  await expect
    .poll(
      async () => {
        const next = await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          fullPage: true
        });
        const stable = image?.equals(next);
        image = next;
        return stable;
      },
      { message: name + ' must settle for two consecutive screenshots' }
    )
    .toBe(true);
  if (process.env.E2E_CAPTURE_STUDENT_BASELINE === '1') {
    await mkdir(resolve(baseline, info.project.name), { recursive: true });
    await writeFile(path, image, { flag: 'wx' });
  } else {
    const original = await readFile(path);
    if (!original.equals(image)) {
      await info.attach(name + '-dev', { body: original, contentType: 'image/png' });
      await info.attach(name + '-react', { body: image, contentType: 'image/png' });
      expect.soft(image.equals(original), name + ' differs from dev').toBe(true);
    }
  }
}

test('student appointment states, API and storage match dev', async ({ page }, info) => {
  // Keep actual D1/R2 and credential checks. Stabilize only the expiring QR payload.
  await page.route('**/api/appointments/*/scan-code', async (route) => {
    const response = await route.fetch();
    await route.fulfill(
      response.ok() ? { response, json: { code: 'pioneer-visual-fixture' } } : { response }
    );
  });
  await page.goto('/#lookup');
  await expect(page.getByText('此浏览器暂无预约记录')).toBeVisible();
  await capture(page, info, 'lookup-empty');
  await page.locator('[data-book-new]').click();
  await capture(page, info, 'booking-initial');

  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const unavailable = async (route) => {
    await blocked;
    await route.fulfill({ status: 503, json: { error: '测试读取失败' } });
  };
  await page.route('**/api/booking-availability?*', unavailable);
  await page.locator('[data-campus="南湖"]').click();
  await expect(page.locator('#booking-selection')).toHaveText('正在读取可预约日期…');
  await capture(page, info, 'availability-loading');
  release();
  await expect(page.locator('#booking-retry')).toBeVisible();
  await capture(page, info, 'availability-error');
  await page.unroute('**/api/booking-availability?*', unavailable);
  await page.locator('#booking-retry').click();
  await expect(page.locator('[data-slot="19:00–19:30"]')).toBeEnabled();
  await expect(page.locator('#booking-picker')).toHaveAttribute('aria-busy', 'false');
  await capture(page, info, 'booking-slots');
  await chooseTime(page);
  await capture(page, info, 'booking-device');
  await page.locator('#step-two-next').click();
  await expect(page.locator('[name=deviceType]')).toBeFocused();
  await capture(page, info, 'booking-validation');
  await fillDevice(page);
  await page
    .locator('#appointment-attachments')
    .setInputFiles({ name: '故障.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(page.locator('[data-preview] img')).toBeVisible();
  await page.locator('[data-preview]').click();
  await expect(page.locator('#photo-large')).toBeVisible();
  await capture(page, info, 'photo-preview');
  await page.keyboard.press('Escape');
  await expect(
    page.locator(info.project.name === 'webkit-mobile' ? 'body' : '[data-preview]')
  ).toBeFocused();

  await goReview(page);
  const draft = await page.evaluate(() => JSON.parse(sessionStorage.pioneerStudentBookingDraft));
  expect(draft).toMatchObject({
    step: 3,
    fields: { campus: '南湖', name: '预约测试同学', qqAccount: '123456789' }
  });
  await capture(page, info, 'booking-review');
  await page.locator('#agreement-link').click();
  await capture(page, info, 'agreement');
  await page.keyboard.press('Escape');
  await page.locator('#open-signature').click();
  await page.locator('#confirm-signature').click();
  await expect(page.locator('#signature-error')).toContainText('不能留白');
  await capture(page, info, 'signature-error');
  await page.locator('#cancel-signature').click();
  await page.locator('[name=agreement]').check();
  await sign(page);
  const request = page.waitForRequest(
    (r) => r.url().endsWith('/api/appointments') && r.method() === 'POST'
  );
  await page.locator('#booking-submit').click();
  const submission = await request;
  expect(submission.headers()['idempotency-key']).toMatch(/^[\w-]{43}$/);
  expect(submission.postDataJSON()).toMatchObject({
    campus: '南湖',
    timeSlot: '19:00–19:30',
    contactValue: '123456789',
    agreementAccepted: true,
    agreementVersion: 'v20250301',
    signature: { version: 2 }
  });
  expect(submission.postDataJSON()).not.toHaveProperty('qqAccount');
  await expect(page.locator('#success-repair-qr img')).toBeVisible();
  await expect(page.locator('#success-photo-message')).toHaveText('照片已全部上传。');
  await capture(page, info, 'booking-success');

  const stored = await page.evaluate(() => ({
    entries: JSON.parse(localStorage.pioneerAppointmentAccess),
    attempt: sessionStorage.getItem('pioneerStudentBookingAttempt'),
    draft: sessionStorage.getItem('pioneerStudentBookingDraft')
  }));
  expect(stored).toMatchObject({
    entries: [{ id: expect.any(String), accessToken: expect.stringMatching(/^[\w-]{43}$/) }],
    attempt: null,
    draft: null
  });
  await page.locator('#success-panel [data-view-link=lookup]').click();
  await expect(page.locator('.student-record')).toHaveCount(1);
  await capture(page, info, 'lookup-list');
  await page.locator('.student-record').click();
  await expect(page).toHaveURL(/#detail=/);
  await page.reload();
  await expect(page.locator('#detail-current-qr img')).toBeVisible();
  await expect(page.locator('#detail-attachments button')).toHaveCount(1);
  await capture(page, info, 'lookup-detail');
  await page.locator('[data-cancel-open]').click();
  await capture(page, info, 'cancel-confirmation');
  await page.locator('[data-cancel-confirm]').click();
  await expect(page.locator('#detail-status')).toHaveText('已取消');
  const { id, accessToken } = stored.entries[0];
  const response = await page.request.get('/api/appointments/' + id, {
    headers: { 'X-Appointment-Token': accessToken }
  });
  expect(await response.json()).toMatchObject({ status: 'cancelled' });
  await page.goBack();
  await expect(page.locator('#lookup-list')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#detail-status')).toHaveText('已取消');
});

test('staff entry and authenticated workspace match dev', async ({ page }, info) => {
  await page.goto('/staff/');
  await expect(page.locator('#login-id')).toBeVisible();
  await capture(page, info, 'staff-login');
  await loginStaff(page);
  await staffPage(page, '预约记录');
  await expect(page.getByRole('heading', { name: '预约记录', exact: true })).toBeVisible();
  await expect(page.getByText('没有符合条件的预约', { exact: true })).toBeVisible();
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
  await capture(page, info, 'staff-records');
});

test('notice revision, draft reload, lost response and photo retry match dev', async ({
  page,
  context,
  workflowTime
}, info) => {
  const staff = await context.newPage();
  await loginStaff(staff);
  const now = Date.parse(workflowTime);
  const notice = {
    campus: '南湖',
    id: 'equivalence-notice',
    revision: -1,
    title: '预约核对公告',
    content: '请携带电源适配器。',
    important: true,
    enabled: true,
    displayMode: 'modal',
    startsAt: new Date(now - 3600000).toISOString(),
    endsAt: new Date(now + 86400000).toISOString()
  };
  const publish = (input) =>
    staffApi(staff, '/api/booking-notices', { ...input, requestId: crypto.randomUUID() }, 'PATCH');
  await publish(notice);
  await page.bringToFront();
  await page.goto('/');
  await page.locator('[data-campus="南湖"]').click();
  const modal = page.locator('#booking-notice-modal');
  const accept = modal.locator('[data-read-notice]');
  await expect(modal).toBeVisible();
  await capture(page, info, 'booking-notice');
  await accept.click();
  await page.locator('#close-booking-notices').click();
  await chooseTime(page);
  await fillDevice(page, { studentId: '20269997', name: '恢复测试同学' });
  await goReview(page);
  await page.reload();
  await page.locator('#draft-restore').click();
  await expect(modal).toBeVisible();
  await accept.click();
  await page.locator('#close-booking-notices').click();
  await page.locator('#step-one-next').click();
  await expect(page.locator('[name=name]')).toHaveValue('恢复测试同学');
  await expect(page.locator('[name=qqAccount]')).toHaveValue('123456789');
  await page.locator('#appointment-attachments').setInputFiles([
    { name: '保留.png', mimeType: 'image/png', buffer: PHOTO },
    { name: '重试.png', mimeType: 'image/png', buffer: PHOTO }
  ]);
  await expect(page.locator('[data-preview] img')).toHaveCount(2);
  await goReview(page);
  await page.locator('[name=agreement]').check();
  await sign(page);

  await publish({ ...notice, revision: 0, content: '请携带设备与电源适配器。' });
  await page.bringToFront();
  await page.locator('#booking-submit').click();
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('请携带设备与电源适配器。');
  await expect(accept).toHaveAttribute('aria-pressed', 'false');
  await accept.click();
  await page.locator('#close-booking-notices').click();
  await page.locator('#step-one-next').click();
  await goReview(page);
  await expect(page.locator('#confirmed-signature')).toBeVisible();
  await expect(page.locator('[name=agreement]')).toBeChecked();

  const requests = [];
  await page.route('**/api/appointments', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const key = route.request().headers()['idempotency-key'];
    requests.push({ kind: 'create', key, notices: route.request().postDataJSON().acceptedNotices });
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort('failed');
  });
  await page.route('**/api/booking-attempts/resolve', (route) => {
    requests.push({ kind: 'resolve', key: route.request().postDataJSON().requestKey });
    return route.continue();
  });
  const uploads = [];
  await page.route('**/api/appointments/*/attachments', async (route) => {
    const filename = decodeURIComponent(route.request().headers()['x-attachment-filename'] || '');
    uploads.push(filename);
    if (
      filename.startsWith('重试') &&
      uploads.filter((name) => name.startsWith('重试')).length === 1
    )
      return route.fulfill({ status: 503, json: { error: '测试上传失败' } });
    return route.continue();
  });
  await page.locator('#booking-submit').click();
  await expect(page.locator('[data-upload-state="failed"]')).toContainText('测试上传失败');
  expect(requests).toEqual([
    {
      kind: 'create',
      key: expect.stringMatching(/^[\w-]{43}$/),
      notices: [{ id: notice.id, revision: 1 }]
    },
    { kind: 'resolve', key: requests[0].key }
  ]);
  await page.locator('#success-photo-retry').click();
  await expect(page.locator('#success-photo-message')).toHaveText('照片已全部上传。');
  expect(uploads.map((name) => name.split('.')[0])).toEqual(['保留', '重试', '重试']);
  await staff.close();
});
