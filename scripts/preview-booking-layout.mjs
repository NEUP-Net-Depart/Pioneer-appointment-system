import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// A separate, read-only local preview; none of these overrides enter dist/.
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.BOOKING_LAYOUT_PORT || 8790);
const slotsFor = count => count === 4
  ? ['19:00–19:30', '19:30–20:00', '20:00–20:30', '20:30–21:00']
  : ['19:00–20:00', '20:00–21:00'];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg' };
const gallery = await readFile(new URL('./booking-layout-preview.html', import.meta.url), 'utf8');

const server = createServer(async (request, response) => {
  const send = (body, type = 'text/plain; charset=utf-8', status = 200) => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body);
  };
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.method !== 'GET') return send(JSON.stringify({ error: '本地布局预览不接受预约提交' }), 'application/json', 403);
    if (url.pathname === '/') return send(gallery, mime['.html']);
    const match = url.pathname.match(/^\/scenario\/([1-4])\/([24])\/(.*)$/);
    if (!match) return send('Not found', undefined, 404);
    const [, days, slotCount, resource] = match, prefix = `/scenario/${days}/${slotCount}/`;
    const timeSlots = slotsFor(Number(slotCount));
    const instant = `2026-10-${16 - Number(days)}T12:00:00+08:00`;
    if (resource === 'preview-clock.js') {
      return send(`
const NativeDate=Date;
globalThis.__bookingPreviewConfig={days:${Number(days)},slotCount:${Number(slotCount)},overrides:{}};
globalThis.__bookingPreviewInstant=${JSON.stringify(instant)};
globalThis.__bookingPreviewReady=new Promise(resolve=>{globalThis.__bookingPreviewResolve=resolve;});
globalThis.Date=class extends NativeDate{
  constructor(...args){super(...(args.length?args:[globalThis.__bookingPreviewInstant]));}
  static now(){return NativeDate.parse(globalThis.__bookingPreviewInstant);}
};
const nativeFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=(input,options)=>{
  const url=new URL(input instanceof Request?input.url:input,location.href);
  if(url.origin!==location.origin||!url.pathname.endsWith('/api/live/summary'))return nativeFetch(input,options);
  const config=globalThis.__bookingPreviewConfig,campus=url.searchParams.get('campus'),date=url.searchParams.get('date');
  const slots=config.slotCount===4?${JSON.stringify(slotsFor(4))}:${JSON.stringify(slotsFor(2))};
  const summary={date,slotCapacities:{},slots:{}};
  slots.forEach((slot,index)=>{
    const counts=config.overrides[JSON.stringify([campus,date,slot])]||config.overrides[JSON.stringify([campus,'*',slot])]||{capacity:10,remaining:10-index-(campus==='浑南'?3:1)};
    summary.slotCapacities[slot]=counts.capacity;summary.slots[slot]=counts.capacity-counts.remaining;
  });
  return Promise.resolve(new Response(JSON.stringify(summary),{headers:{'Content-Type':'application/json'}}));
};`, mime['.js']);
    }
    if (resource === 'api/live/summary') {
      const campus = url.searchParams.get('campus');
      return send(JSON.stringify({ date: url.searchParams.get('date'),
        slotCapacities: Object.fromEntries(timeSlots.map(slot => [slot, 10])),
        slots: Object.fromEntries(timeSlots.map((slot, index) => [slot, campus === '浑南' ? index + 3 : index + 1]))
      }), 'application/json');
    }
    const path = resolve(dist, resource || 'index.html'), inside = relative(dist, path);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) return send('Not found', undefined, 404);
    const extension = extname(path);
    if (!mime[extension]) return send('Not found', undefined, 404);
    let content = await readFile(path);
    if (extension === '.js') {
      content = content.toString().replaceAll('\r\n', '\n').replaceAll('/shared/', `${prefix}shared/`).replaceAll('/api/', `${prefix}api/`);
      if (resource === 'shared/constants.js') content = content.replace(/export const TIME_SLOTS = .*?;/, `export const TIME_SLOTS = ${JSON.stringify(timeSlots)};`);
      if (resource === 'user/slot-picker.js') {
        // Expose the real picker's refresh only in the simulated server response.
        const anchor = '  const stopPolling = startVisiblePolling(() => refreshing ? undefined : refresh());\n  return {';
        if (!content.includes(anchor)) throw new Error('Preview picker bridge anchor missing');
        content = content.replace(anchor, `
  const stopPolling = startVisiblePolling(() => refreshing ? undefined : refresh());
  globalThis.__bookingPreviewApply = async config => {
    globalThis.__bookingPreviewConfig = config;
    globalThis.__bookingPreviewInstant = config.instant || '2026-10-' + (16 - config.days) + 'T12:00:00+08:00';
    const nextSlots = config.slotCount === 4 ? ${JSON.stringify(slotsFor(4))} : ${JSON.stringify(slotsFor(2))};
    if (TIME_SLOTS.join() !== nextSlots.join()) {
      TIME_SLOTS.splice(0, TIME_SLOTS.length, ...nextSlots);
      slots.replaceChildren(...TIME_SLOTS.map(slot => choiceButton(slot, 'slot', slot)));
      if (!TIME_SLOTS.includes(slotInput.value)) slotInput.value = '';
    }
    await refresh();
  };
  globalThis.__bookingPreviewResolve();
  return {`);
      }
    } else if (extension === '.html') {
      content = content.toString().replaceAll('="/shared/', `="${prefix}shared/`).replaceAll('="/user/', `="${prefix}user/`).replaceAll('="/assets/', `="${prefix}assets/`)
        .replace('<script type="module"', `<script src="${prefix}preview-clock.js"></script><script type="module"`)
        .replace('<button class="primary-btn" type="submit">', '<button class="primary-btn" type="submit" disabled title="布局预览不接受预约提交">');
    }
    send(content, mime[extension]);
  } catch (error) { send(error.code === 'ENOENT' ? 'Not found' : 'Preview unavailable', undefined, error.code === 'ENOENT' ? 404 : 500); }
});
server.listen(port, '127.0.0.1', () => console.log(`Booking layout preview: http://127.0.0.1:${server.address().port}/ (read-only simulated data)`));
