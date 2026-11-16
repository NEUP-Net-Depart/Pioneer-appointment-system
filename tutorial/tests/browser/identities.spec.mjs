import { test, expect } from '@playwright/test';
import { profiles } from '../../src/simulation/fixtures.js';

const demonstrations = {
  head: 'planner',
  'deputy-head': 'member-create',
  'department-head': 'planner',
  'department-deputy': 'capacity',
  director: 'campus',
  'deputy-director': 'weekly-export',
  president: 'accounts',
  'vice-president': 'statistics',
  affairs: 'receive',
  repair: 'checkin',
  exchange: 'checkin',
  retired: 'planner',
  superadmin: 'retired-identity'
};

for (const profile of profiles) {
  test(`${profile.name} uses the matching permissions and completes a representative flow`, async ({
    page
  }) => {
    const lesson = demonstrations[profile.id];
    await page.goto(`/staff/?profile=${profile.id}&lesson=${lesson}&session=identity`);
    await expect.poll(() => page.evaluate(() => !!window.__tutorial)).toBe(true);
    await page.evaluate(() => window.__tutorial.initialize());
    const total = await page.evaluate(() => window.__tutorial.course.steps.length);
    for (let index = 0; index < total; index++)
      await page.evaluate(async (step) => {
        await window.__tutorial.highlight(step);
        await window.__tutorial.perform(step, true);
      }, index);
    if (profile.id === 'affairs')
      expect(await page.evaluate(() => window.__tutorial.simulation.state.orders[0].status)).toBe(
        'booked'
      );
    if (profile.id === 'retired')
      expect(
        await page.evaluate(
          () => window.__tutorial.simulation.state.actor.permissions['attendance.self']
        )
      ).toBe(false);
    if (['repair', 'exchange'].includes(profile.id)) {
      expect(await page.evaluate(() => window.__tutorial.simulation.state.attendances.length)).toBe(
        1
      );
      expect(await page.evaluate(() => window.__tutorial.find('text=人员管理'))).toBe(null);
    }
  });
}
