import { fail } from '../../lib/http.js';
import { encryptText, decryptText } from '../../lib/privacy.js';

const pageUrl = 'https://support.acer.com.cn/AcerSite/Views/ASP/WarrantyQuery.aspx?sheet=acer';
const imageUrl = 'https://support.acer.com.cn/AcerSite/tools/verify_code.ashx';
const purpose = 'warranty-acer-captcha-v1';
const ttlMs = 3 * 60 * 1000;
const prefix = 'ctl00$ContentPlaceHolder1$';
function decode(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code) => {
    if (code[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[code.toLowerCase()] || all;
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  });
}
export function acerText(html) {
  return decode(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
export function acerFields(html) {
  const fields = {};
  for (const input of html.match(/<input\b[^>]*>/gi) || []) {
    const attrs = Object.fromEntries([...input.matchAll(/([\w$-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3])]));
    if (attrs.type?.toLowerCase() === 'hidden' && ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION', prefix + 'hfSheetBrand', prefix + 'HiddenField1'].includes(attrs.name)) fields[attrs.name] = attrs.value || '';
  }
  if (!fields.__VIEWSTATE || !fields.__EVENTVALIDATION || fields[prefix + 'hfSheetBrand'] !== 'acer') fail(502, 'Acer 查询页面结构已变化，暂时无法获取验证码。', 'WARRANTY_UPSTREAM_FORMAT');
  return fields;
}
function cookies(headers, current = '') {
  const jar = new Map(current.split('; ').filter(Boolean).map(pair => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
  const values = headers.getSetCookie?.() || (headers.get('set-cookie') || '').split(/,(?=\s*[^;,\s]+=)/);
  for (const value of values) {
    const pair = value.split(';')[0].trim();
    const index = pair.indexOf('=');
    if (index > 0 && /^[\w.-]+$/.test(pair.slice(0, index)) && !/[\r\n;]/.test(pair)) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  const result = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  if (result.length > 4096) fail(502, 'Acer 会话异常，请稍后重试。', 'WARRANTY_UPSTREAM_FORMAT');
  return result;
}
async function bytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) fail(502, 'Acer 未返回有效内容。', 'WARRANTY_UPSTREAM_FORMAT');
  const parts = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); fail(502, 'Acer 返回内容过大，暂时无法查询。', 'WARRANTY_UPSTREAM_FORMAT'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(length); let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.length; }
  return data;
}
export function normalizeAcerWarranty(html) {
  const plain = acerText(html);
  if (/验证码.{0,15}(?:错误|不正确|失效)|(?:错误|不正确).{0,15}验证码/.test(plain)) fail(422, 'Acer 验证码不正确或已失效，请获取新验证码。', 'WARRANTY_CAPTCHA_INVALID');
  if (/(?:未|没有|无法|无|不).{0,8}(?:查询到|查到|找到|存在).{0,16}(?:序号|序列号|机器|产品|记录|信息)|(?:序号|序列号).{0,12}(?:不存在|无效|错误)/.test(plain)) return { outcome: 'not_found', status: 'unknown', services: [] };
  const services = [];
  // Only return warranty-labelled rows, never the full page or unrelated owner/contact fields.
  for (const table of html.match(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi) || []) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(match => [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(cell => acerText(cell[1]).slice(0, 240)));
    const header = rows.findIndex(row => row.some(cell => /保修|质保/.test(cell)) && row.some(cell => /日期|期限|起始|截止|到期/.test(cell)));
    if (header >= 0) {
      const columns = rows[header];
      const allowed = columns.map(cell => /保修|质保|部件|配件|服务项目|产品型号|机器型号/.test(cell));
      for (const row of rows.slice(header + 1)) {
        const values = row.filter((cell, i) => allowed[i] && cell);
        if (values.length) services.push({ name: values.join(' · '), category: 'Acer 原厂保修信息', start: '', end: '', status: 'unknown' });
      }
    } else for (const row of rows) {
      if (row.length >= 2 && /保修|质保|部件|配件|服务项目|产品型号|机器型号/.test(row[0])) services.push({ name: row.slice(0, 2).join('：'), category: 'Acer 原厂保修信息', start: '', end: '', status: 'unknown' });
    }
  }
  if (!services.some(service => /保修|质保/.test(service.name))) fail(502, 'Acer 未返回可识别的保修明细；不会据此判为过保。请核对序号，或使用官网确认。', 'WARRANTY_UPSTREAM_FORMAT');
  return { outcome: 'found', status: 'unknown', services: services.slice(0, 100) };
}
export function acerWarranty({ fetcher, clock, encryptionKey, timeoutMs }) {
  async function run(work) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let cookie = '';
    async function request(url, options = {}) {
      const response = await fetcher(url, { ...options, signal: controller.signal, redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
      if (!response.ok) fail(502, 'Acer 官方服务暂时不可用，请稍后重试。', 'WARRANTY_UPSTREAM');
      cookie = cookies(response.headers, cookie);
      return response;
    }
    try { return await work(request, value => { cookie = value; }, () => cookie); }
    catch (error) {
      if (error.status) throw error;
      fail(502, controller.signal.aborted ? 'Acer 查询超时，请重试。' : '无法连接 Acer 官方服务，请稍后重试。', controller.signal.aborted ? 'WARRANTY_TIMEOUT' : 'WARRANTY_UPSTREAM');
    } finally { clearTimeout(timer); }
  }
  return {
    async challenge(serial, actor) {
      if (!encryptionKey || !actor?.account) fail(503, '人工验证码服务尚未配置。', 'WARRANTY_UNAVAILABLE');
      return run(async (request, _setCookie, getCookie) => {
        const page = await request(pageUrl);
        const fields = acerFields(new TextDecoder().decode(await bytes(page, 128 * 1024)));
        const image = await request(imageUrl);
        const mime = image.headers.get('content-type')?.split(';')[0].toLowerCase();
        if (!['image/png', 'image/jpeg', 'image/gif'].includes(mime)) fail(502, 'Acer 未返回图片验证码，请重试。', 'WARRANTY_UPSTREAM_FORMAT');
        const data = await bytes(image, 64 * 1024);
        if (!data.length) fail(502, 'Acer 验证码图片为空，请重试。', 'WARRANTY_UPSTREAM_FORMAT');
        let binary = ''; for (const byte of data) binary += String.fromCharCode(byte);
        const expires = clock().getTime() + ttlMs;
        const state = JSON.stringify({ purpose, serial, account: actor.account, expires, fields, cookie: getCookie() });
        if (state.length > 8192) fail(502, 'Acer 会话内容异常，请重试。', 'WARRANTY_UPSTREAM_FORMAT');
        return { brand: 'acer', serial, image: `data:${mime};base64,${btoa(binary)}`, token: await encryptText(state, encryptionKey), expiresAt: new Date(expires).toISOString() };
      });
    },
    async query(serial, input, actor) {
      if (!actor?.account || typeof input.captchaToken !== 'string' || input.captchaToken.length > 12000 || typeof input.captchaAnswer !== 'string' || !/^[a-z0-9]{1,12}$/i.test(input.captchaAnswer.trim())) fail(400, '请先获取并人工填写原厂验证码。', 'WARRANTY_CAPTCHA_REQUIRED');
      let state;
      try { state = JSON.parse(await decryptText(input.captchaToken, encryptionKey)); } catch { fail(400, '验证码会话无效，请重新获取。', 'WARRANTY_CAPTCHA_INVALID'); }
      if (state.purpose !== purpose || state.serial !== serial || state.account !== actor.account) fail(400, '验证码不属于当前查询，请重新获取。', 'WARRANTY_CAPTCHA_INVALID');
      if (!Number.isFinite(state.expires) || state.expires <= clock().getTime()) fail(410, '验证码已过期，请重新获取。', 'WARRANTY_CAPTCHA_EXPIRED');
      return run(async (request, setCookie) => {
        setCookie(state.cookie);
        const body = new URLSearchParams({ ...state.fields, [prefix + 'txtSerialno']: serial, [prefix + 'txtVeriCode']: input.captchaAnswer.trim(), [prefix + 'btnQuery']: '查 询' });
        const response = await request(pageUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        const result = normalizeAcerWarranty(new TextDecoder().decode(await bytes(response, 256 * 1024)));
        return { brand: 'acer', serial, ...result, checkedAt: clock().toISOString(), source: { name: 'Acer 中国官方服务', url: 'https://www.acer.com.cn/myhelp.html?serverid=62&type=2' }, note: '以上为原厂返回的保修信息。暂未据此自动判断整机状态；购机凭证、部件及地区政策以 Acer 最终核定为准。' };
      });
    }
  };
}
