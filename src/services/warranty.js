import { huaweiWarranty, captchaBridgeOrigin } from './warranty/huawei.js';
import { acerWarranty } from './warranty/acer.js';
import { WARRANTY_BRANDS, normalizeDeviceSerial, isDeviceSerial } from '../../shared/warranty.js';
import { fail } from '../lib/http.js';

const origin = 'https://consumerservice.lenovo.com.cn';
const reasons = {
  asus: 'ASUS 使用绑定原厂网站的 reCAPTCHA，暂不能在本站直接弹出并完成查询；仍需原厂集成支持。',
  acer: 'Acer 官方网页查询需要验证码，尚未接通自动查询接口。',
  hp: 'HP Warranty API 需要原厂批准的企业授权；当前未配置。',
  dell: 'Dell TechDirect API 需要组织申请的密钥与授权；当前未接通。',
  msi: 'MSI 原厂入口在当前环境返回 403，尚无法取得验证码及会话。',
  apple: '尚未取得 Apple 可供此系统使用的保修查询接口。',
  xiaomi: '尚未找到小米笔记本公开可用的序列号保修查询接口。',
  huawei: '华为人工验证服务尚未配置，请联系管理员启用独立验证站点。',
  honor: '尚未取得荣耀可供此系统使用的保修查询接口。',
  mechrevo: '机械革命现有查询入口需要在官方小程序绑定设备，尚未接通后台接口。'
};
const hardwareClasses = new Set(['基础服务', 'EB延保类', 'EB延保及上门类', '延保类', '延保类服务', '延保及上门类服务', 'SB延保类']);
const text = value => typeof value === 'string' ? value.trim().slice(0, 240) : '';
function date(value) {
  const match = text(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]|$)/);
  if (!match) return '';
  const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(day + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : '';
}
function coverage(start, end, today) {
  if (!start || !end || end < start) return 'unknown';
  if (start > today) return 'pending';
  return end < today ? 'expired' : 'in_warranty';
}
export function normalizeLenovoWarranty(payload, today) {
  if (String(payload?.statusCode) === '100' && /保修信息不存在/.test(payload.message || '')) {
    return { outcome: 'not_found', status: 'unknown', services: [] };
  }
  const detail = payload?.data?.detailinfo;
  if (String(payload?.statusCode) !== '200' || !detail ||
      !['warranty', 'onsite', 'other'].every(key => Array.isArray(detail[key]))) {
    fail(502, '联想返回的数据格式发生变化，暂时无法确认保修。', 'WARRANTY_UPSTREAM_FORMAT');
  }
  const services = ['warranty', 'onsite', 'other'].flatMap(group => detail[group].slice(0, 100).map(row => {
    const name = text(row.ServiceProductName) || '原厂服务项目';
    const category = text(row.ServiceProductSmallClass);
    const start = date(row.PartStartDate || row.LaborStartDate || row.StartDate);
    const end = date(row.PartEndDate || row.LaborEndDate || row.EndDate);
    return { name, category, start, end, status: coverage(start, end, today),
      hardware: hardwareClasses.has(category) && !/部件加装|保外维修/.test(name) };
  }));
  const hardware = services.filter(row => row.hardware);
  // An accident plan, battery extension, or on-site visit alone does not prove hardware coverage.
  const status = hardware.some(row => row.status === 'in_warranty') ? 'in_warranty'
    : hardware.length && hardware.every(row => row.status === 'expired') ? 'expired' : 'unknown';
  return { outcome: services.length ? 'found' : 'not_found', status, services };
}

export function warrantyService({ fetcher = fetch, clock = () => new Date(), timeoutMs = 12000, encryptionKey, captchaOrigin } = {}) {
  const bridgeOrigin = captchaBridgeOrigin(captchaOrigin);
  const huawei = huaweiWarranty({ fetcher, clock, encryptionKey, timeoutMs, bridgeOrigin });
  const acer = acerWarranty({ fetcher, clock, encryptionKey, timeoutMs });
  return {
    providers() {
      return { providers: WARRANTY_BRANDS.map(brand => ({ id: brand.id, available: brand.id === 'lenovo' || (['acer', 'huawei'].includes(brand.id) && !!encryptionKey && (brand.id === 'acer' || !!bridgeOrigin)),
        mode: ['acer', 'huawei'].includes(brand.id) ? 'captcha' : 'automatic',
        ...(brand.id === 'huawei' ? { captchaOrigin: bridgeOrigin } : {}),
        message: brand.id === 'huawei' && encryptionKey && bridgeOrigin ? '已接入原厂人工验证组件；请完成图片或滑块验证，保修明细仍需实机验证。' : brand.id === 'acer' && encryptionKey ? '已接入原厂图片验证码流程，请人工填写后查询；保修明细仍需实机验证。' : brand.id === 'lenovo' ? '已接通联想中国官方服务接口，可直接返回保修明细。' : reasons[brand.id] })) };
    },
    async challenge(input, actor) {
      const serial = typeof input?.serial === 'string' ? normalizeDeviceSerial(input.serial) : '';
      if (!['acer', 'huawei'].includes(input?.brand) || !isDeviceSerial(serial)) fail(400, '请选择可用的人工验证品牌并输入有效序列号。', 'WARRANTY_INPUT');
      return input.brand === 'huawei' ? huawei.challenge(serial, actor) : acer.challenge(serial, actor);
    },
    async query(input, actor) {
      const brand = WARRANTY_BRANDS.find(item => item.id === input?.brand);
      const serial = typeof input?.serial === 'string' ? normalizeDeviceSerial(input.serial) : '';
      if (!brand || !isDeviceSerial(serial)) fail(400, '请选择品牌并输入有效的完整序列号。', 'WARRANTY_INPUT');
      if (brand.id === 'huawei' && encryptionKey && bridgeOrigin) return huawei.query(serial, input, actor);
      if (brand.id === 'acer' && encryptionKey) return acer.query(serial, input, actor);
      if (brand.id !== 'lenovo') fail(503, reasons[brand.id], 'WARRANTY_UNAVAILABLE');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(`${origin}/api/drive/${encodeURIComponent(serial)}/drivewarrantyinfo`, {
          headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'manual'
        });
        if (!response.ok) fail(502, '联想官方服务暂时不可用，请稍后重试。', 'WARRANTY_UPSTREAM');
        let payload;
        try { payload = await response.json(); }
        catch { fail(502, '联想未返回可识别的保修信息，请稍后重试。', 'WARRANTY_UPSTREAM_FORMAT'); }
        const now = clock();
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
        return { brand: brand.id, serial, ...normalizeLenovoWarranty(payload, today), checkedAt: now.toISOString(),
          source: { name: '联想中国官方服务', url: `${origin}/deviceGuarantee.html` },
          note: '项目状态按原厂返回的服务起止日期（中国标准时间）计算，不代表所有部件均在保。部分设备按生产或出库日期计算，购机发票可能影响最终保修，以联想最终核定为准。' };
      } catch (error) {
        if (error.status) throw error;
        fail(502, controller.signal.aborted ? '原厂查询超时，请重试。' : '无法连接联想官方服务，请稍后重试。', controller.signal.aborted ? 'WARRANTY_TIMEOUT' : 'WARRANTY_UPSTREAM');
      } finally { clearTimeout(timer); }
    }
  };
}
