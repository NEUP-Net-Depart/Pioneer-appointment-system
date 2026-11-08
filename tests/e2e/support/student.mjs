import { expect } from '@playwright/test';
export const PHOTO=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
export async function chooseTime(page,campus='南湖') {
  await page.locator(`[data-campus="${campus}"]`).click();await expect(page.locator('#booking-days button').first()).toBeEnabled();
  await page.locator('[data-slot="19:00–19:30"]').click();await page.locator('#step-one-next').click();await expect(page.locator('[data-step="2"]')).toBeVisible();
}
export async function fillDevice(page,{studentId='20269998',name='预约测试同学'}={}) {
  await page.locator('[name=deviceType]').selectOption('笔记本');await page.locator('[name=brand]').selectOption('联想');
  await page.locator('[name=liquidMetal][value="不清楚"]').check();await page.locator('[name=warranty][value="否"]').check();await page.locator('[name=faultType][value="蓝屏"]').check();
  await page.locator('[name=name]').fill(name);await page.locator('[name=studentId]').fill(studentId);await page.locator('[name=college]').selectOption('计算机科学与工程学院');
  await page.locator('[name=contactType][value=qq]').check();await page.locator('[name=qqAccount]').fill('123456789');
}
export async function goReview(page){await page.locator('#step-two-next').click();await expect(page.locator('[data-step="3"]')).toBeVisible();}
export async function sign(page){await page.locator('#open-signature').click();await expect(page.locator('#signature-modal')).toBeVisible();const box=await page.locator('#signature-canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.1,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.45,{steps:15});await page.mouse.move(box.x+box.width*.3,box.y+box.height*.7,{steps:15});await page.mouse.up();await page.locator('#confirm-signature').click();await expect(page.locator('#signature-modal')).toBeHidden();
}
export async function submitStudent(page){await page.locator('[name=agreement]').check();await sign(page);await page.locator('#booking-submit').click();await expect(page.locator('#success-panel')).toBeVisible();}
