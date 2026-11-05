import {test,expect} from '@playwright/test';

async function harness(page){
 await page.route('**/__photo-test',route=>route.fulfill({contentType:'text/html',body:'<html><body><script src="/assets/vendor/load-image.all.min.js"></script></body></html>'}));await page.goto('/__photo-test');await page.waitForFunction(()=>typeof window.loadImage==='function');
}
// EXIF APP1 segment with one Orientation entry in a big-endian TIFF IFD.
function exifJpeg(bytes, orientation) {
  const segment = Buffer.from('ffe100224578696600004d4d002a00000008000101120003000000010001000000000000', 'hex');
  segment.writeUInt16BE(orientation, 28);
  return Buffer.concat([bytes.subarray(0, 2), segment, bytes.subarray(2)]).toString('base64');
}

test('all eight EXIF orientations produce upright JPEG pixels without a second rotation', async ({ page }) => {
  await harness(page);
  const base = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
    const ctx = canvas.getContext('2d');
    for (const [index, color] of ['#ff0000', '#00ff00', '#0000ff', '#ffff00'].entries()) {
      ctx.fillStyle = color; ctx.fillRect(index % 2 * 40, Math.floor(index / 2) * 20, 40, 20);
    }
    return canvas.toDataURL('image/jpeg', 1).split(',')[1];
  });
  const corners = [[0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1], [0, 2, 1, 3], [2, 0, 3, 1], [3, 1, 2, 0], [1, 3, 0, 2]];
  for (let orientation = 1; orientation <= 8; orientation++) {
    const result = await page.evaluate(async base64 => {
      const { compressImage } = await import('/shared/image-compress.js');
      const file = new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'camera.jpg', { type: 'image/jpeg' });
      const result = await compressImage(file);
      const url = URL.createObjectURL(result.file), image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
      const pixels = [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([x, y]) => {
        const rgb = ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data;
        const distances = palette.map(color => color.reduce((sum, channel, index) => sum + (channel - rgb[index]) ** 2, 0));
        return distances.indexOf(Math.min(...distances));
      });
      URL.revokeObjectURL(url);
      return { width: image.width, height: image.height, pixels, warning: result.warning };
    }, exifJpeg(Buffer.from(base, 'base64'), orientation));
    expect(result.warning).toBe('');
    expect([result.width, result.height]).toEqual(orientation >= 5 ? [40, 80] : [80, 40]);
    expect(result.pixels, `EXIF ${orientation}`).toEqual(corners[orientation - 1]);
  }
});

test('large camera photos shrink below 2 MB with a longest side of at most 2560 px', async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 3300; canvas.height = 2200;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(canvas.width, canvas.height);
    let seed = 1234;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + channel] = seed >>> 24; }
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 1));
    const file = new File([original], 'camera.jpg', { type: 'image/jpeg' });
    const { compressImage } = await import('/shared/image-compress.js');
    const result = await compressImage(file);
    const url = URL.createObjectURL(result.file), image = new Image();
    await new Promise(resolve => { image.onload = resolve; image.src = url; });
    URL.revokeObjectURL(url);
    return { originalSize: file.size, size: result.file.size, width: image.width, height: image.height, warning: result.warning };
  });
  expect(result.originalSize).toBeGreaterThan(2 * 1024 * 1024);
  expect(result.size).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2560);
  expect(result.width / result.height).toBeCloseTo(1.5, 2);
  expect(result.warning).toBe('');
});
