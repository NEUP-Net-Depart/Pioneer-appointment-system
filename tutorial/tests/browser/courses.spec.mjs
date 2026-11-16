import { test, expect } from '@playwright/test';
import { courses, courseAllowed } from '../../src/courses.js';
import { profiles, permissionsFor } from '../../src/simulation/fixtures.js';

for (const course of courses) {
  const profile = profiles.find(
    (item) =>
      item.id ===
      (course.group === 'mine'
        ? 'affairs'
        : course.permission === 'global'
          ? 'director'
          : course.group === 'system'
            ? 'superadmin'
            : 'head')
  );
  if (!courseAllowed(course, profile, permissionsFor(profile))) continue;
  test(`${profile.id} / ${course.id} / ${course.title}`, async ({ page }) => {
    const faults = [];
    const apiRequests = [];
    page.on('pageerror', (error) => faults.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
    });
    await page.goto(`/staff/?profile=${profile.id}&lesson=${course.id}&session=test`);
    await expect
      .poll(() => page.evaluate(() => !!window.__tutorial), { timeout: 20000 })
      .toBe(true);
    await page.evaluate(async () => {
      await window.__tutorial.initialize();
    });
    for (let index = 0; index < course.steps.length; index++) {
      await test.step(course.steps[index].title, async () => {
        try {
          await page.evaluate(async (step) => {
            await window.__tutorial.highlight(step);
            await window.__tutorial.perform(step, true);
          }, index);
        } catch (error) {
          const snapshot = await page.evaluate(() => ({
            requests: window.__tutorial.requests.map((item) => ({
              path: item.path,
              method: item.method
            })),
            attendance: window.__tutorial.simulation.state.attendances,
            hasManagement: document.querySelector('.duty-day')?.dataset.canManage,
            details: document.querySelectorAll('.duty-checkin-detail').length
          }));
          console.log(JSON.stringify(snapshot, null, 2));
          throw error;
        }
      });
    }
    expect(faults).toEqual([]);
    expect(apiRequests).toEqual([]);
  });
}
