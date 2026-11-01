import { fail } from '../../lib/http.js';
import { encryptText, decryptText } from '../../lib/privacy.js';

const gateway = 'https://sgw-cn.c.huawei.com/forward';
const risk = 'https://brandzone-cn.c.huawei.com/2cRiskControl/verificationcode/v1';
const site = 'https://consumer.huawei.com/cn/support/warranty-query/';
const business = { businessId: 'huaweisupport', sceneId: 'warrantyquery', siteCode: 'cn' };
const purpose = 'warranty-huawei-captcha-v1';
const clean = value => typeof value === 'string' ? value.trim().slice(0, 240) : '';
export function captchaBridgeOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return '';
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) ? url.origin : '';
  } catch { return ''; }
}
export function normalizeHuaweiWarranty(payload) {
  const code = String(payload?.responseCode);
  if (code === '501') fail(422, '华为验证码不正确或已失效，请重新验证。', 'WARRANTY_CAPTCHA_INVALID');
  if (code !== '200') {
    if (code === '5000' && /不存在|未查询到|未找到|无效序列号/.test(payload.responseDesc || '')) return { outcome: 'not_found', status: 'unknown', services: [] };
    fail(502, '华为未返回有效保修结果，请稍后重试。', 'WARRANTY_UPSTREAM_FORMAT');
  }
  const data = payload.responseData;
  if (!data?.device || !Array.isArray(data.deviceRight)) fail(502, '华为保修返回格式已变化，暂时无法确认。', 'WARRANTY_UPSTREAM_FORMAT');
  const services = data.deviceRight.filter(group => String(group.privilegeFlag) === '1').slice(0, 100).flatMap(group => (Array.isArray(group.privilegeInfoList) ? group.privilegeInfoList : []).slice(0, 100).map(item => ({
    name: clean(item.displayName) || clean(group.displayName) || '华为原厂服务项目', category: clean(item.serviceCatCode), start: clean(item.startDate), end: clean(item.endDate), status: 'unknown'
  }))).slice(0, 100);
  // Keep raw service dates. Real-device samples must establish any overall coverage mapping.
  return { outcome: 'found', status: 'unknown', model: clean(data.device.displayName), services };
}
export function huaweiWarranty({ fetcher, clock, encryptionKey, timeoutMs, bridgeOrigin }) {
  async function run(work, initialCookies = '') {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cookies = new Map((Array.isArray(initialCookies) ? initialCookies : []).map(cookie => [cookie.domain + cookie.path + cookie.name, cookie]));
    const cookieString = url => [...cookies.values()].filter(cookie => {
      const target = new URL(url);
      return (cookie.hostOnly ? target.hostname === cookie.domain : target.hostname === cookie.domain || target.hostname.endsWith('.' + cookie.domain)) && target.pathname.startsWith(cookie.path);
    }).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    async function request(url, { body, headers = {} } = {}) {
      const response = await fetcher(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'application/json', ...(cookies.size ? { Cookie: cookieString(url) } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) fail(502, '华为原厂服务暂时不可用，请稍后重试。', 'WARRANTY_UPSTREAM');
      for (const item of response.headers.getSetCookie?.() || (response.headers.get('set-cookie') || '').split(/,(?=\s*[^;,\s]+=)/)) {
        const pair = item.split(';')[0].trim(); const index = pair.indexOf('=');
        const host = new URL(url).hostname;
        const domainAttr = item.match(/;\s*domain=([^;]+)/i)?.[1].trim().replace(/^\./, '').toLowerCase();
        const domain = domainAttr || host;
        if (domain !== host && !['c.huawei.com', 'huawei.com'].includes(domain)) continue;
        if (host !== domain && !host.endsWith('.' + domain)) continue;
        const path = item.match(/;\s*path=([^;]+)/i)?.[1].trim() || '/';
        if (index > 0 && /^[\w.-]+$/.test(pair.slice(0, index)) && !/[\r\n;]/.test(pair)) {
          const cookie = { name: pair.slice(0, index), value: pair.slice(index + 1), domain, path, hostOnly: !domainAttr };
          cookies.set(domain + path + cookie.name, cookie);
        }
      }
      if (JSON.stringify([...cookies.values()]).length > 5000) fail(502, '华为会话异常，请重试。', 'WARRANTY_UPSTREAM_FORMAT');
      const raw = await response.text();
      if (raw.length > 512 * 1024) fail(502, '华为返回内容异常。', 'WARRANTY_UPSTREAM_FORMAT');
      try { return JSON.parse(raw); } catch { fail(502, '华为未返回可识别的数据。', 'WARRANTY_UPSTREAM_FORMAT'); }
    }
    try { return await work(request, () => [...cookies.values()]); }
    catch (error) {
      if (error.status) throw error;
      fail(502, controller.signal.aborted ? '华为查询超时，请重试。' : '无法连接华为原厂服务，请重试。', controller.signal.aborted ? 'WARRANTY_TIMEOUT' : 'WARRANTY_UPSTREAM');
    } finally { clearTimeout(timer); }
  }
  return {
    async challenge(serial, actor) {
      if (!bridgeOrigin || !encryptionKey || !actor?.account) fail(503, '华为人工验证需要配置独立的验证组件域名。', 'WARRANTY_UNAVAILABLE');
      if (!/^[A-Z0-9]{10,30}$/.test(serial)) fail(400, '华为设备序列号应为 10–30 位英数字。', 'WARRANTY_INPUT');
      return run(async (request, cookieString) => {
        const csrf = await request(gateway + '/myhuawei/uum/csrfToken/1', { headers: { 'SGW-APP-ID': 'EDCF82D77A5AB59706CD5F2163F67427' } });
        if (csrf.resultCode !== 0 || typeof csrf.data !== 'string' || csrf.data.length > 4096) fail(502, '无法建立华为验证会话。', 'WARRANTY_UPSTREAM_FORMAT');
        const headers = { Tcsrftoken: csrf.data };
        const config = await request(risk + '/query', { body: business, headers });
        if (config.resultCode !== 0 || ![0, 1, 2].includes(config.data?.type)) fail(503, '华为当前验证类型暂不支持，请使用官网。', 'WARRANTY_UNAVAILABLE');
        const type = config.data.type;
        const result = await request(risk + (type === 0 ? '/picture' : '/register'), { body: type === 0 ? {} : { ...business, type }, headers });
        if (result.resultCode !== 0 || !result.data) fail(502, '华为未返回有效验证码。', 'WARRANTY_UPSTREAM_FORMAT');
        const data = result.data;
        const expires = clock().getTime() + 180000;
        const state = { purpose, serial, account: actor.account, expires, type, csrf: csrf.data, cookies: cookieString() };
        let presentation;
        if (type === 0) {
          if (typeof data.picture !== 'string' || data.picture.length > 90000 || !/^[a-z0-9+/=\s]+$/i.test(data.picture) || typeof data.sessionId !== 'string') fail(502, '华为图片验证码格式异常。', 'WARRANTY_UPSTREAM_FORMAT');
          state.sessionId = data.sessionId;
          presentation = { image: 'data:image/png;base64,' + data.picture };
        } else {
          for (const key of ['challenge', 'hcg', 'hct']) {
            if (typeof data[key] !== 'string' || !data[key] || data[key].length > 4096) fail(502, '华为滑块参数异常。', 'WARRANTY_UPSTREAM_FORMAT');
            state[key] = data[key];
          }
          presentation = { widget: { origin: bridgeOrigin, type, lang: config.data.lang || 'zh-CN', challenge: state.challenge, hcg: state.hcg, hct: state.hct, nonce: crypto.randomUUID() } };
        }
        const encoded = JSON.stringify(state);
        if (encoded.length > 12000) fail(502, '华为会话内容异常。', 'WARRANTY_UPSTREAM_FORMAT');
        return { brand: 'huawei', serial, token: await encryptText(encoded, encryptionKey), expiresAt: new Date(expires).toISOString(), ...presentation };
      });
    },
    async query(serial, input, actor) {
      if (!actor?.account || typeof input.captchaToken !== 'string' || input.captchaToken.length > 18000) fail(400, '请先完成人工验证。', 'WARRANTY_CAPTCHA_REQUIRED');
      let state;
      try { state = JSON.parse(await decryptText(input.captchaToken, encryptionKey)); } catch { fail(400, '华为验证会话无效，请重新获取。', 'WARRANTY_CAPTCHA_INVALID'); }
      if (state.purpose !== purpose || state.serial !== serial || state.account !== actor.account) fail(400, '验证码不属于本次查询。', 'WARRANTY_CAPTCHA_INVALID');
      if (!Number.isFinite(state.expires) || state.expires <= clock().getTime()) fail(410, '华为验证码已过期，请重新获取。', 'WARRANTY_CAPTCHA_EXPIRED');
      let verification;
      if (state.type === 0) {
        if (typeof input.captchaAnswer !== 'string' || !/^[a-z0-9]{1,12}$/i.test(input.captchaAnswer.trim())) fail(400, '请人工填写图片验证码。', 'WARRANTY_CAPTCHA_REQUIRED');
        verification = { sessionId: state.sessionId, verifyCode: input.captchaAnswer.trim(), type: 0, validate: '0', challenge: '0', hcg: '0', hct: '0' };
      } else {
        if (typeof input.captchaProof !== 'string' || input.captchaProof.length < 8 || input.captchaProof.length > 4096) fail(400, '请人工完成原厂滑块验证。', 'WARRANTY_CAPTCHA_REQUIRED');
        verification = { type: state.type, validate: input.captchaProof, challenge: state.challenge, hcg: state.hcg, hct: state.hct };
      }
      return run(async request => {
        const body = { sn: serial, countryCode: 'cn', langCode: 'zh-cn', langType: 'zh-cn', country: 'CN', language: 'zh-cn', channelCode: 'WEBSITE', siteCode: 'zh_CN', verifyCodeSiteCode: 'cn', needShowCarePlusFlag: 'Y', ...verification };
        const payload = await request(gateway + '/ccpc/ccps/getDeviceRightWithVerifyCode/1000', { body, headers: { 'SGW-APP-ID': '96E6614BD648F3582A2D6D657C5CC768', Tcsrftoken: state.csrf } });
        return { brand: 'huawei', serial, ...normalizeHuaweiWarranty(payload), checkedAt: clock().toISOString(), source: { name: '华为中国官方服务', url: site }, note: '以上为原厂返回的权益项目与日期，暂不自动判定整机在保状态；实际保修以华为核定为准。' };
      }, state.cookies);
    }
  };
}
