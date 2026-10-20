import {test,expect} from '@playwright/test';
import {mockStaff,loginStaff} from './support/staff.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');

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
    const stages = [];
    const { compressImage } = await import('/shared/image-compress.js');
    const result = await compressImage(file, { onProgress: stage => stages.push(stage) });
    const url = URL.createObjectURL(result.file), image = new Image();
    await new Promise(resolve => { image.onload = resolve; image.src = url; });
    URL.revokeObjectURL(url);
    return { originalSize: file.size, size: result.file.size, width: image.width, height: image.height, warning: result.warning, stages };
  });
  expect(result.originalSize).toBeGreaterThan(2 * 1024 * 1024);
  expect(result.size).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2560);
  expect(result.width / result.height).toBeCloseTo(1.5, 2);
  expect(result.warning).toBe('');
  expect(result.stages.at(-1).value).toBe(100);
  expect(result.stages.some(stage => stage.label.includes('第 2 次'))).toBe(true);
});

test('missing MIME, absent bitmap/toBlob/File APIs and transparent PNGs are handled', async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 1000;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 2000, 1000);
    const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const file = new File([original], 'camera', { type: '' });
    window.createImageBitmap = undefined;
    Blob.prototype.arrayBuffer = undefined;
    HTMLCanvasElement.prototype.toBlob = undefined;
    window.File = function () { throw new Error('File constructor unsupported'); };
    const { compressImage } = await import('/shared/image-compress.js');
    const result = await compressImage(file);
    const url = URL.createObjectURL(result.file), image = new Image();
    await new Promise(resolve => { image.onload = resolve; image.src = url; });
    const preview = document.createElement('canvas'); preview.width = image.width; preview.height = image.height;
    const previewCtx = preview.getContext('2d'); previewCtx.drawImage(image, 0, 0);
    const white = [...previewCtx.getImageData(image.width - 10, 10, 1, 1).data];
    URL.revokeObjectURL(url);
    return { name: result.file.name, type: result.file.type, width: image.width, height: image.height, white, warning: result.warning };
  });
  expect(result).toEqual({ name: 'camera.jpg', type: 'image/jpeg', width: 2560, height: 640, white: [255, 255, 255, 255], warning: '' });
});

test('the size target stays soft and never inflates small images or needlessly reduces quality', async ({ page }) => {
  await harness(page);
  const results = await page.evaluate(async base64 => {
    const { compressImage } = await import('/shared/image-compress.js');
    const file = new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0)), new Uint8Array(3 * 1024 * 1024)], 'camera.png', { type: 'image/png' });
    const originalToBlob = HTMLCanvasElement.prototype.toBlob, outcomes = [];
    try {
      for (const sizes of [[.6], [1.7, 1.2], [1.7, .8], [1.7, 1.6]]) {
        const qualities = []; let call = 0;
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
          qualities.push(quality); callback(new Blob([new Uint8Array(Math.round(sizes[call++] * 1024 * 1024))], { type }));
        };
        const result = await compressImage(file);
        outcomes.push({ size: result.file.size / 1024 / 1024, qualities, warning: result.warning });
      }
    } finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; }
    return outcomes;
  }, png.toString('base64'));
  for (const [index, size] of [.6, 1.2, 1.7, 1.7].entries()) {
    expect(results[index].size).toBeCloseTo(size, 5);
    expect(results[index].qualities).toEqual(index === 0 ? [.85] : [.85, .8]);
    expect(results[index].warning).toBe('');
  }
});

test('compression failures allow only supported originals below the hard limit; HEIC never falls back', async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async base64 => {
    const { compressImage } = await import('/shared/image-compress.js');
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); };
    const small = await compressImage(new File([bytes], 'camera.png', { type: '' }));
    const errors = [];
    for (const file of [
      new File([bytes, new Uint8Array(2 * 1024 * 1024)], 'big.png', { type: 'image/png' }),
      new File(['\x00\x00\x00\x18ftypheic\x00\x00\x00\x00heic'], 'camera.heic', { type: '' }),
      new File(['not an image'], 'photo.png', { type: 'image/png' }),
    ]) {
      try { await compressImage(file); errors.push('accepted'); } catch (error) { errors.push(error.message); }
    }
    return { type: small.file.type, size: small.file.size, warning: small.warning, errors };
  }, png.toString('base64'));
  expect(result.type).toBe('image/png'); expect(result.size).toBe(png.length);
  expect(result.warning).toContain('压缩失败'); expect(result.warning).toContain('将上传原图');
  expect(result.errors[0]).toContain('原图超过 2 MB');
  expect(result.errors[1]).toContain('HEIC/HEIF'); expect(result.errors[1]).toContain('转为 JPG');
  expect(result.errors[2]).toContain('照片格式不支持');
});


async function repair(page){
 const id='reserve020261015-01',uploads=[],starts=[],controls={failBack:false,failStart:false};
 let item={id,status:'booked',revision:0,campus:'南湖',date:'2026-10-15',timeSlot:'19:00–19:30',brand:'联想',deviceModel:'ThinkPad',canStart:true,canReadDetails:true};
 await mockStaff(page,{contexts:[{id:'repair',label:'维修工作台'}]});
 await page.route('**/api/scan/resolve',route=>route.fulfill({json:item}));await page.route('**/api/field/appointments/'+id,route=>route.fulfill({json:item}));
 await page.route('**/api/appointments/'+id+'/attachments',route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{items:[]}});
  const body=route.request().postDataJSON();uploads.push(body);
  if(controls.failBack&&body.purpose==='intake_back'){controls.failBack=false;return route.fulfill({status:500,json:{error:'模拟背面上传失败'}});}
  return route.fulfill({status:201,json:{id:body.filename}});
 });
 await page.route('**/api/appointments/'+id+'/status',route=>{
  const body=route.request().postDataJSON();starts.push(body);if(controls.failStart){controls.failStart=false;return route.fulfill({status:500,json:{error:'模拟开始维修失败'}});}
  item={...item,...body,canStart:false,canFinish:true,revision:item.revision+1};return route.fulfill({json:item});
 });
 await loginStaff(page);const open=async()=>{await page.getByRole('combobox',{name:'预约编号',exact:true}).fill(id);await page.getByRole('button',{name:'查询',exact:true}).click();await expect(page.getByRole('button',{name:'确认开始维修',exact:true})).toBeVisible();};await open();
 const select=(side,name,type='image/png',buffer=png)=>page.getByLabel(side==='front'?'设备正面照片':'设备背面照片',{exact:true}).setInputFiles({name,mimeType:type,buffer});
 return {uploads,starts,controls,select,open,confirm:page.getByRole('button',{name:'确认开始维修',exact:true})};
}
test('React intake requires both photos and never starts from one attachment',async({page})=>{
 const {select,confirm,uploads,starts}=await repair(page);await select('front','front.png');await confirm.click();await expect(page.getByRole('dialog')).toContainText('请选择两张');expect(uploads).toHaveLength(1);expect(starts).toHaveLength(0);
});
test('React intake replaces a failed photo and reuses the unchanged uploaded side',async({page})=>{
 const {select,confirm,uploads,starts,controls}=await repair(page);controls.failBack=true;await select('front','front.png');await select('back','old-back.png');await confirm.click();await expect(page.getByRole('dialog')).toContainText('模拟背面上传失败');await select('back','new-back.png');await confirm.click();await expect.poll(()=>starts.length).toBe(1);expect(starts[0]).toMatchObject({frontPhotoId:'front.png',backPhotoId:'new-back.png'});expect(uploads.map(x=>x.filename)).toEqual(['front.png','old-back.png','new-back.png']);
});
test('a failed start keeps uploaded IDs and reuses the same operation ID on retry',async({page})=>{
 const {select,confirm,uploads,starts,controls}=await repair(page);controls.failStart=true;await select('front','front.png');await select('back','back.png');await confirm.click();await expect(page.getByRole('dialog')).toContainText('模拟开始维修失败');await confirm.click();await expect.poll(()=>starts.length).toBe(2);expect(starts[0]).toEqual(starts[1]);expect(uploads).toHaveLength(2);
});
test('React photo IDs and verification restore after a reload without reuploading the unchanged side',async({page})=>{
 const {select,confirm,uploads,starts,controls,open}=await repair(page);controls.failBack=true;await select('front','front.png');await select('back','bad-back.png');await confirm.click();await expect(page.getByRole('dialog')).toContainText('模拟背面上传失败');await page.reload();await expect(page.locator('.field-app:not(.workspace-bootstrap)')).toBeVisible();await open();await expect(page.locator('.field-photos')).toContainText('已上传');await select('back','back-retry.png');await page.getByRole('button',{name:'确认开始维修',exact:true}).click();await expect.poll(()=>starts.length).toBe(1);expect(starts[0].frontPhotoId).toBe('front.png');expect(uploads.filter(x=>x.purpose==='intake_front')).toHaveLength(1);
});
test('React intake rejects HEIC and oversized originals without recording a repair',async({page})=>{
 const {select,confirm,uploads,starts}=await repair(page);await select('front','camera.heic','image/heic',Buffer.from('unsupported'));await select('back','back.png');await confirm.click();await expect(page.getByRole('dialog')).toContainText('JPEG、PNG 或 WebP');expect(starts).toHaveLength(0);expect(uploads).toHaveLength(0);
 await select('front','large.png','image/png',Buffer.alloc(6*1024*1024));await confirm.click();await expect(page.getByRole('dialog')).toContainText('不超过 5 MB');expect(starts).toHaveLength(0);
});
test('React confirmation joins its pending upload once and blocks closing while saving',async({page})=>{
 const {select,confirm,uploads,starts}=await repair(page);let release,started;const pending=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve);
 await page.route('**/api/appointments/*/attachments',async route=>{if(route.request().method()==='GET')return route.fulfill({json:{items:[]}});const body=route.request().postDataJSON();uploads.push(body);started();await pending;return route.fulfill({status:201,json:{id:body.filename}});});
 await select('front','front.png');await select('back','back.png');await confirm.click();await ready;await expect(page.getByRole('button',{name:'正在保存核验信息…',exact:true})).toBeDisabled();await page.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();release();await expect.poll(()=>starts.length).toBe(1);expect(uploads).toHaveLength(2);
});

test('React intake compresses a camera original above 2 MB before uploading its verified photo', async ({page}) => {
  const {select,confirm,uploads,starts}=await repair(page);
  const bytes=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
    const context=canvas.getContext('2d'),pixels=context.createImageData(1024,1024);
    let seed=71;
    for(let i=0;i<pixels.data.length;i+=4){for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+c]=seed>>>24;}pixels.data[i+3]=255;}
    context.putImageData(pixels,0,0);return canvas.toDataURL('image/png').split(',')[1];
  });
  const original=Buffer.from(bytes,'base64');expect(original.length).toBeGreaterThan(2*1024*1024);expect(original.length).toBeLessThan(5*1024*1024);
  await select('front','large-camera.png','image/png',original);await select('back','back.png');await confirm.click();
  await expect.poll(()=>starts.length).toBe(1);
  const front=uploads.find(photo=>photo.purpose==='intake_front');expect(front.mimeType).toBe('image/jpeg');
  expect(Buffer.from(front.data,'base64').length).toBeLessThanOrEqual(2*1024*1024);
});
