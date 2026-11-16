import { test, expect } from '@playwright/test';
import { journeysFor, tutorialProfiles } from '../../src/journeys.js';

for (const profile of tutorialProfiles) {
  for (const journey of journeysFor(profile)) {
    test(`${profile.name} / ${journey.title} follows one coherent workflow`, async ({ page }) => {
      await page.goto(`/?profile=${profile.id}&journey=${journey.id}&harness=1`);
      await expect.poll(() => page.evaluate(() => !!window.__tutorial)).toBe(true);
      await page.evaluate(() => window.__tutorial.initialize());
      let started = false;
      for (let index = 0; index < journey.steps.length; index++) {
        await test.step(journey.steps[index].title, async () => {
          const step = journey.steps[index];
          if (step.action?.some((action) => action.type === 'attendanceImage')) {
            expect(
              await page.evaluate(() => window.__tutorial.simulation.state.attendances.length)
            ).toBe(0);
          }
          if (step.action?.some((action) => action.type === 'upload' && action.side === 'front')) {
            expect(
              await page.evaluate(
                () =>
                  window.__tutorial.simulation.state.orders.find(
                    (item) => item.id === window.__tutorial.simulation.state.activeOrderId
                  ).frontPhotoId
              )
            ).toBeFalsy();
          }
          if (step.teaches?.includes('finish')) expect(started).toBe(true);
          await page.evaluate(async (step) => {
            await window.__tutorial.highlight(step);
            await window.__tutorial.perform(step, true);
          }, index);
          if (step.teaches?.includes('receive-start')) started = true;
          if (step.action?.some((action) => action.type === 'attendanceImage')) {
            expect(
              await page.evaluate(() => window.__tutorial.simulation.state.attendances.length)
            ).toBe(0);
            await expect(
              page.locator('[data-track="staff.field.fieldapp.button.5"]')
            ).toBeVisible();
          }
        });
      }
      const state = await page.evaluate(() => window.__tutorial.simulation.state);
      if (['repairs', 'duty-repair'].includes(journey.id)) {
        expect(state.orders[0].status).toBe('completed');
        expect(state.orders[0].receivedBy).toBe(state.actor.account);
        expect(state.orders[0].assignedMemberId).toBe('demo-self');
        expect(state.orders[0].repairNote).toContain('重启三次');
      } else if (journey.id === 'reception') {
        expect(state.orders[0].status).toBe('booked');
        expect(state.orders[0].receivedAt).toBeTruthy();
        expect(state.orders[0].serial).toBe('PF4DEMO26');
        expect(state.orders[0].assignedMemberId).toBeNull();
        expect(state.orders[0].frontPhotoId).toBeTruthy();
        expect(state.orders[0].backPhotoId).toBeTruthy();
        const created = state.orders.find((item) => item.id === state.activeOrderId);
        expect(created.id).not.toBe(state.orders[0].id);
        expect(created.receivedAt).toBeTruthy();
        expect(created.assignedMemberId).toBeNull();
      } else if (journey.id === 'attendance') {
        expect(state.attendances.some((item) => item.memberId === 'demo-self')).toBe(true);
        if (profile.id === 'head') {
          expect(
            Date.parse(state.attendances.find((item) => item.memberId === 'demo-wen').occurredAt)
          ).toBe(Date.parse(`${state.today}T19:10:00+08:00`));
        }
      } else if (journey.id === 'shift-change') {
        const accepted = state.covers.find((item) => item.status === 'accepted');
        expect(state.assignments.find((item) => item.id === accepted.assignmentId).memberId).toBe(
          'demo-self'
        );
      }
    });
  }
}
