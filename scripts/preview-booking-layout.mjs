import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// A separate, read-only local preview; none of these overrides enter dist/.
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.BOOKING_LAYOUT_PORT || 8790);
import { bookingDates } from '../shared/booking-slots.js';
import { DEFAULT_SERVICE_LOCATIONS } from '../shared/constants.js';
const slotsFor = () => ['19:00–19:30', '19:30–20:00', '20:00–20:30', '20:30–21:00'];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.wasm':'application/wasm' };
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
  if(url.origin!==location.origin||!url.pathname.endsWith('/api/booking-availability'))return nativeFetch(input,options);
  const config=globalThis.__bookingPreviewConfig,campus=url.searchParams.get('campus');
  const nativeInstant=new NativeDate(globalThis.__bookingPreviewInstant);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(nativeInstant);
  const items=[0,1,2,3].map(offset=>{const day=new NativeDate(today+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+offset);return day.toISOString().slice(0,10);}).filter(date=>{const weekday=new NativeDate(date+'T00:00:00Z').getUTCDay();return weekday>=1&&weekday<=4;}).map(date=>{
    const summary={campus,date,location:${JSON.stringify(DEFAULT_SERVICE_LOCATIONS)}[campus],serverNow:nativeInstant.toISOString(),timeSlots:${JSON.stringify(slotsFor())},slotCapacities:{},slots:{}};
    summary.timeSlots.forEach((slot,index)=>{
      const counts=config.overrides[JSON.stringify([campus,date,slot])]||config.overrides[JSON.stringify([campus,'*',slot])]||{capacity:10,remaining:10-index-(campus==='浑南'?3:1)};
      summary.slotCapacities[slot]=counts.capacity;summary.slots[slot]=counts.capacity-counts.remaining;
    });return summary;
  });
  return Promise.resolve(new Response(JSON.stringify({serverNow:nativeInstant.toISOString(),items}),{headers:{'Content-Type':'application/json'}}));
};`, mime['.js']);
    }
    if (resource === 'api/booking-availability') {
      const campus = url.searchParams.get('campus');
      return send(JSON.stringify({serverNow:new Date(instant).toISOString(),items:bookingDates(new Date(instant)).map(date=>({campus,date,location:DEFAULT_SERVICE_LOCATIONS[campus],serverNow:new Date(instant).toISOString(),timeSlots,
        slotCapacities:Object.fromEntries(timeSlots.map(slot=>[slot,10])),slots:Object.fromEntries(timeSlots.map((slot,index)=>[slot,index+1]))}))}), 'application/json');
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
        const anchor = '  render();\n  return {';
        if (!content.includes(anchor)) throw new Error('Preview picker bridge anchor missing');
        content = content.replace(anchor, `
  render();
  globalThis.__bookingPreviewApply = async config => {
    globalThis.__bookingPreviewConfig = config;
    globalThis.__bookingPreviewInstant = config.instant;
    await refresh();
  };
  globalThis.__bookingPreviewResolve();
  return {`);
      }
    } else if (extension === '.html') {
      content = content.toString().replaceAll('="/shared/', `="${prefix}shared/`).replaceAll('="/user/', `="${prefix}user/`).replaceAll('="/assets/', `="${prefix}assets/`)
        .replace('<script type="module"', `<script src="${prefix}preview-clock.js"></script><script type="module"`)
        .replace('id="booking-submit" type="submit"', 'id="booking-submit" type="submit" disabled title="布局预览不接受预约提交"');
    }
    send(content, mime[extension]);
  } catch (error) { send(error.code === 'ENOENT' ? 'Not found' : 'Preview unavailable', undefined, error.code === 'ENOENT' ? 404 : 500); }
});
server.listen(port, '127.0.0.1', () => console.log(`Booking layout preview: http://127.0.0.1:${server.address().port}/ (read-only simulated data)`));
