let instance;
let started = false;
let verified = false;
let recipient;
const status = document.getElementById('status');
const reopen = document.getElementById('reopen');
function reply(kind, values = {}) {
  if (recipient) parent.postMessage({ channel: 'pioneer-warranty', kind, nonce: recipient.nonce, ...values }, recipient.origin);
}
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.channel !== 'pioneer-warranty' || event.data.kind !== 'start' || started) return;
  if (!/^https?:\/\//.test(event.origin)) return;
  const config = event.data.config;
  if (!config || typeof config.nonce !== 'string' || ![1, 2].includes(config.type) || !['challenge', 'hcg', 'hct'].every(key => typeof config[key] === 'string' && config[key].length <= 4096)) return;
  started = true;
  recipient = { origin: event.origin, nonce: config.nonce };
  reply('telemetry', { result: 'start' });
  try {
    // Use the official SDK directly. Do not turn initialization errors into verification success.
    instance = window.initHuaweiCaptcha({ appId: 'huaweisupport', businessId: 'huaweisupport', sceneId: 'warrantyquery', serviceDomain: ['csc-adapter-drcn.security.dbankcloud.cn'], mode: 'popup', width: '268px', type: config.type, lang: 'zh-CN', challenge: config.challenge, hcg: config.hcg, hct: config.hct, isCloseable: true }, () => {
      status.textContent = '请人工完成原厂滑块验证。'; reopen.hidden = false; queueMicrotask(() => instance?.popupShow());
    }, data => {
      if (verified || data.resultCode !== 0 || data.isFallback || typeof data.validate !== 'string' || data.validate.length < 8) return;
      verified = true; status.textContent = '正在提交原厂验证结果…'; reopen.hidden = true;
      reply('telemetry', { result: 'ok' });
      reply('proof', { proof: data.validate });
    }, () => { reply('telemetry', { result: 'cancelled' }); status.textContent = '你已关闭滑块，可点击按钮重新显示。'; }, error => {
      const code = Number.isFinite(error?.errorCode) ? error.errorCode : 'unknown';
      status.textContent = '原厂验证组件未能加载（代码 ' + code + '），请在查询窗口重新获取验证码。'; reply('telemetry', { result: 'error' }); reply('error');
    });
  } catch {
    status.textContent = '原厂验证组件未能加载，请在查询窗口重新获取验证码。'; reply('telemetry', { result: 'error' }); reply('error');
  }
});
reopen.addEventListener('click', () => { reply('telemetry', { result: 'start' }); instance?.popupShow(); });
window.addEventListener('error', () => reply('telemetry', { result: 'error' }));
window.addEventListener('unhandledrejection', () => reply('telemetry', { result: 'error' }));
window.addEventListener('pagehide', () => instance?.destroy());
parent.postMessage({ channel: 'pioneer-warranty', kind: 'ready' }, '*');
