// Fixed first-party consumer channels; only verified deep links include serials.
export const WARRANTY_BRANDS = [
  { id: 'asus', name: '华硕 / ASUS / ROG', aliases: ['华硕', '華碩', 'asus', 'rog'], url: 'https://www.asus.com.cn/support/warranty-status-inquiry/', serviceCenterUrl: 'https://www.asus.com.cn/support/service-center/', hint: '输入机身 S/N，并按官方页面完成验证与查询。' },
  { id: 'acer', name: '宏碁 / Acer', aliases: ['宏碁', '宏基', 'acer', 'predator'], url: 'https://www.acer.com.cn/myhelp.html?serverid=62&type=2', serviceCenterUrl: 'https://www.acer.com.cn/myhelp.html?type=1&serverid=15', hint: '在「质保信息查询」中输入产品序号或 SNID。' },
  { id: 'lenovo', name: '联想 / Lenovo / ThinkPad', aliases: ['联想', '聯想', 'lenovo', 'thinkpad', 'thinkbook', '拯救者'], url: 'https://consumerservice.lenovo.com.cn/', serviceCenterUrl: 'https://newsupport.lenovo.com.cn/serverNet.html', hint: '在联想服务中选择保修查询；部分产品需要补充主机信息。' },
  { id: 'hp', name: '惠普 / HP / OMEN', aliases: ['惠普', 'hp', 'omen'], url: 'https://support.hp.com/cn-zh/check-warranty', serviceCenterUrl: 'https://support.hp.com/cn-zh/help/service-center', hint: '选择实际购买国家或地区；部分设备还需要产品编号（P/N）。' },
  { id: 'dell', name: '戴尔 / Dell / Alienware', aliases: ['戴尔', '戴爾', 'dell', 'alienware'], url: 'https://www.dell.com/support/home/zh-cn', serviceCenterUrl: 'https://www.dell.com/support/diagnose/zh-cn/servicecenter', hint: '在「确认产品或寻求支持」粘贴 Service Tag（服务编号），选择「识别或搜索」，再查看支持服务／保修详情。' },
  { id: 'msi', name: '微星 / MSI', aliases: ['微星', 'msi'], url: 'https://account.msi.com/zh-Hans/services/warranty-book', serviceCenterUrl: 'https://cn.msi.com/page/service-location-cn-2/', hint: '输入产品序列号，并亲自完成图片验证码及官方同意事项。' },
  { id: 'apple', name: '苹果 / Apple / Mac', aliases: ['苹果', '蘋果', 'apple', 'macbook', 'imac'], url: 'https://checkcoverage.apple.com/?locale=zh_CN', serviceCenterUrl: 'https://locate.apple.com/cn/zh/', hint: '输入设备序列号，按官方页面要求完成验证或登录。' },
  { id: 'xiaomi', name: '小米 / Xiaomi / REDMI Book', aliases: ['小米', 'xiaomi', 'redmi', '红米', '紅米'], url: 'https://www.mi.com/service/aftersale/front', serviceCenterUrl: 'https://www.mi.com/service/sitelist', hint: '登录机主的小米账号后选择订单，或选择「填写申请单」粘贴 SN 查看设备售后信息；也可在小米商城 App「我的 → 退换/售后」输入 IMEI/SN。此处不是免登录的笔电保修查询表。' },
  { id: 'huawei', name: '华为 / HUAWEI / MateBook', aliases: ['华为', '華為', 'huawei', 'matebook'], url: 'https://consumer.huawei.com/cn/support/warranty-query/', serviceCenterUrl: 'https://consumer.huawei.com/cn/support/service-center/', hint: '输入设备 SN，并亲自完成官方验证码。商用设备请使用对应产品线的支持入口。' },
  { id: 'honor', name: '荣耀 / HONOR / MagicBook', aliases: ['荣耀', '榮耀', 'honor', 'magicbook'], url: 'https://www.honor.com/cn/support/warranty-query/', serviceCenterUrl: 'https://www.honor.com/cn/support/service-center/', hint: '输入设备 SN，并亲自完成官方验证码。' },
  { id: 'mechrevo', name: '机械革命 / MECHREVO', aliases: ['机械革命', '機械革命', 'mechrevo'], url: 'https://www.mechrevo.com/cn/policy', serviceCenterUrl: 'https://www.mechrevo.com/cn/outlets', hint: '在微信搜索官方「机械革命服务」小程序，绑定设备后查询保修。此链接为官方操作说明。' }
];

const consumerChannels = {
  asus: { kind: 'web', title: 'ASUS 消费者保修查询', steps: ['核对序列号后复制并前往官网，支持自动带入序列号。', '在原厂页面确认同意事项并完成验证，再送出查询。'] },
  acer: { kind: 'web', title: 'Acer 质保信息查询', steps: ['复制序列号，打开官网的质保信息查询页。', '粘贴产品序号／SNID，人工填写验证码后查询。'] },
  lenovo: { kind: 'web', title: '联想消费者保修查询', steps: ['可直接使用本页查询，或复制并前往联想保修页。', '官网链接支持带入主机编号，其他地区产品请切换对应地区。'] },
  hp: { kind: 'web', title: 'HP 消费者保修查询', steps: ['复制序列号并打开 HP「保修状态查询」。', '选择实际购买国家或地区，粘贴序列号；若原厂要求，再补充产品编号（P/N）。'] },
  dell: { kind: 'web', title: 'Dell 消费者支持与保修', steps: ['复制 Service Tag（服务编号），在支持主页粘贴至「确认产品或寻求支持」。', '点击「识别或搜索」，在设备页查看支持服务／保修详情。'] },
  msi: { kind: 'web', title: 'MSI 消费者保修信息查询', steps: ['复制产品序号并打开 MSI 保修信息查询。', '粘贴序号，人工填写图片验证码并确认原厂同意事项后发送。'] },
  apple: { kind: 'web', title: 'Apple 保障状态查询', steps: ['复制序列号并打开 Apple「查看保障状态」。', '粘贴序列号，按原厂要求完成验证；也可由机主登录自己的 Apple 账户查看设备。'] },
  xiaomi: { kind: 'account', title: '小米商城消费者售后', steps: ['复制 SN，由机主登录小米商城或小米商城 App。', '商城购买的设备选择对应订单；其他渠道选「填写申请单」，粘贴 SN 查看设备售后信息。', 'App 路径：我的 → 退换/售后 → 输入 IMEI/SN；需核定保修时使用原厂显示的信息或官方客服。'] },
  huawei: { kind: 'web', title: '华为消费者保修期及权益查询', steps: ['复制设备 SN 并打开原厂「保修期及权益查询」。', '粘贴 SN，人工完成图片／滑块验证码后查询。'] },
  honor: { kind: 'web', title: '荣耀消费者保修期及权益查询', steps: ['复制设备 SN 并打开原厂「保修查询」。', '粘贴 SN，人工填写图形验证码后查询。'] },
  mechrevo: { kind: 'miniapp', title: '机械革命服务小程序', steps: ['先复制 SN，再打开微信，搜索官方「机械革命服务」小程序。', '粘贴序号并绑定设备，进入「保修查询」或保修权益。', '下方官网提供官方小程序二维码；网页本身不是 SN 查询表。'] }
};
export function warrantyConsumerChannel(brandId) {
  return Object.hasOwn(consumerChannels, brandId) ? consumerChannels[brandId] : null;
}

export function warrantyBrandId(value) {
  const text = String(value || '').normalize('NFKC').trim().toLowerCase();
  return WARRANTY_BRANDS.find(brand => brand.aliases.some(alias => alias === 'hp'
    ? /(?:^|[^a-z])hp(?:[^a-z]|$)/i.test(text)
    : text.includes(alias)))?.id || '';
}

export function warrantyServiceCenterUrl(value) {
  const id = typeof value === 'string' && WARRANTY_BRANDS.some(item => item.id === value)
    ? value
    : warrantyBrandId(value);
  return WARRANTY_BRANDS.find(item => item.id === id)?.serviceCenterUrl || null;
}

export function normalizeDeviceSerial(value) {
  return String(value || '').normalize('NFKC').trim()
    .replace(/^(?:S\s*\/\s*N|SN|SERIAL(?:\s*(?:NUMBER|NO\.?))?|SERVICE\s*TAG)\s*[:：#]\s*/i, '')
    .trim().toUpperCase();
}

export function isDeviceSerial(value) {
  return typeof value === 'string' && /^[A-Z0-9][A-Z0-9/-]{3,39}$/.test(value)
    && !/^(?:[A-F0-9]{2}[:-]){5}[A-F0-9]{2}$/.test(value)
    && !/^(?:RESERVE|REVERSE)\d/i.test(value);
}

const serialKeys = new Set(['sn', 'serial', 'serialnumber', 'serialno', 'serial_number', 'serial_no', 'servicetag']);
function explicitSerial(entries) {
  const candidates = [...new Set(entries.filter(([key, value]) => serialKeys.has(key.toLowerCase()) && typeof value === 'string')
    .map(([, value]) => normalizeDeviceSerial(value)).filter(isDeviceSerial))];
  // Ambiguous labels need human inspection instead of silently picking a value.
  return candidates.length === 1 ? candidates[0] : null;
}
export function deviceSerialFromCode(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  const text = raw.trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      // Appointment credentials must not be copied to a manufacturer's form.
      if (url.hash || /(?:token|credential|appointment|repair)/i.test(url.pathname)) return null;
      if (url.protocol === 'http:' && url.hostname === 'qr.i-tongfang.com'
        && url.port === '8080' && url.pathname.toLowerCase() === '/default.aspx'
        && !url.username && !url.password && [...url.searchParams.keys()].every(key => key === 'qr')
        && url.searchParams.getAll('qr').length === 1) {
        const serial = normalizeDeviceSerial(url.searchParams.get('qr'));
        return isDeviceSerial(serial) ? serial : null;
      }
      if (url.protocol === 'https:' && url.hostname === 'qs.asus.com' && !url.search && !url.port && !url.username && !url.password) {
        const match = /^\/([A-Z0-9-]{10,40})\/?$/i.exec(url.pathname);
        const serial = match && normalizeDeviceSerial(match[1]);
        return serial && /[A-Z]/.test(serial) && /\d/.test(serial) && isDeviceSerial(serial) ? serial : null;
      }
      return explicitSerial([...url.searchParams]);
    } catch { return null; }
  }
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return explicitSerial(Object.entries(data));
    } catch { return null; }
  }
  const serial = normalizeDeviceSerial(text);
  return isDeviceSerial(serial) ? serial : null;
}

export function labelledDeviceSerialCandidatesFromText(raw) {
  if (typeof raw !== 'string' || raw.length > 20000) return [];
  const text = raw.normalize('NFKC').toUpperCase();
  const labelled = [...text.matchAll(/(?:^|[^A-Z0-9])(?:序[ \t]*(?:列[ \t]*)?号|S[ \t]*\/[ \t]*N|SN|SERIAL(?:[ \t]*(?:NUMBER|NO\.?))?|SERVICE[ \t]*TAG)[ \t]*[:：#]?[ \t]*([A-Z0-9][A-Z0-9/-]{3,39})(?=$|[^A-Z0-9/-])/g)].map(match => match[1]);
  return [...new Set(labelled.filter(isDeviceSerial))].slice(0, 8);
}

export function deviceSerialCandidatesFromText(raw) {
  if (typeof raw !== 'string' || raw.length > 20000) return [];
  const text = raw.normalize('NFKC').toUpperCase();
  const labelled = labelledDeviceSerialCandidatesFromText(raw);
  const candidates = labelled.length ? labelled : text.split(/\s+/).map(word => word.replace(/^[^A-Z0-9]+|[^A-Z0-9/-]+$/g, '')).filter(word => word.length >= 8 && /\d/.test(word) && (/[A-Z]/.test(word) || /^\d{11,20}$/.test(word)));
  return [...new Set(candidates.filter(isDeviceSerial))].slice(0, 8);
}

// Only enable parameters confirmed in the manufacturers' own query-page scripts.
export function warrantyOfficialDestination(brandId, value) {
  const brand = WARRANTY_BRANDS.find(item => item.id === brandId);
  const serial = normalizeDeviceSerial(value);
  if (!brand || !isDeviceSerial(serial)) return null;
  if (/^[A-Z0-9-]+$/.test(serial)) {
    if (brandId === 'asus') {
      const url = new URL(brand.url);
      url.searchParams.set('sn', serial);
      return { url: url.href, prefilled: true };
    }
    if (brandId === 'lenovo') {
      const url = new URL('https://consumerservice.lenovo.com.cn/deviceGuarantee.html');
      url.searchParams.set('selname', serial);
      return { url: url.href, prefilled: true };
    }
  }
  return { url: brand.url, prefilled: false };
}
