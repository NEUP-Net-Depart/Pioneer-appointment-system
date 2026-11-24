interface CaptchaConfiguration {
  type: 1 | 2;
  challenge: string;
  hcg: string;
  hct: string;
  nonce: string;
}
interface HuaweiCaptcha {
  popupShow(): void;
  destroy(): void;
}
type InitHuaweiCaptcha = (
  options: Omit<CaptchaConfiguration, 'nonce'> & {
    appId: string; businessId: string; sceneId: string; serviceDomain: string[];
    mode: 'popup'; width: string; lang: string; isCloseable: boolean;
  },
  onReady: () => void,
  onResult: (data: { resultCode: number; isFallback?: boolean; validate?: unknown }) => void,
  onClose: () => void,
  onError: (error?: { errorCode?: number }) => void
) => HuaweiCaptcha;

type Reply =
  | ['telemetry', { result: 'start' | 'ok' | 'cancelled' | 'error' }]
  | ['proof', { proof: string }]
  | ['error'];

let instance: HuaweiCaptcha | undefined;
let started = false;
let verified = false;
let recipient: { origin: string; nonce: string } | undefined;
const statusLabel = document.getElementById('status');
const reopen = document.getElementById('reopen');
if (!statusLabel || !reopen) throw new Error('Missing verifier controls');
const statusText = statusLabel, reopenButton = reopen;
function reply(...[kind, values]: Reply) {
  if (recipient) parent.postMessage({ channel: 'pioneer-warranty', kind, nonce: recipient.nonce, ...values }, recipient.origin);
}
window.addEventListener('message', event => {
  const data: unknown = event.data;
  if (event.source !== parent || !data || typeof data !== 'object' || !('channel' in data) || data.channel !== 'pioneer-warranty' || !('kind' in data) || data.kind !== 'start' || started) return;
  if (!/^https?:\/\//.test(event.origin)) return;
  const config = 'config' in data ? data.config : null;
  if (!config || typeof config !== 'object' || !('nonce' in config) || typeof config.nonce !== 'string' ||
    !('type' in config) || (config.type !== 1 && config.type !== 2) ||
    !('challenge' in config) || !('hcg' in config) || !('hct' in config) ||
    ![config.challenge, config.hcg, config.hct].every(value => typeof value === 'string' && value.length <= 4096)) return;
  const { nonce, type, challenge, hcg, hct } = config as CaptchaConfiguration;
  started = true;
  recipient = { origin: event.origin, nonce };
  reply('telemetry', { result: 'start' });
  try {
    // Use the official SDK directly. Do not turn initialization errors into verification success.
    const initialize = (window as Window & { initHuaweiCaptcha?: InitHuaweiCaptcha }).initHuaweiCaptcha;
    if (!initialize) throw new Error('Missing Huawei SDK');
    instance = initialize.call(window, { appId: 'huaweisupport', businessId: 'huaweisupport', sceneId: 'warrantyquery', serviceDomain: ['csc-adapter-drcn.security.dbankcloud.cn'], mode: 'popup', width: '268px', type, lang: 'zh-CN', challenge, hcg, hct, isCloseable: true }, () => {
      statusText.textContent = '请人工完成原厂滑块验证。'; reopenButton.hidden = false; queueMicrotask(() => instance?.popupShow());
    }, data => {
      if (verified || data.resultCode !== 0 || data.isFallback || typeof data.validate !== 'string' || data.validate.length < 8) return;
      verified = true; statusText.textContent = '正在提交原厂验证结果…'; reopenButton.hidden = true;
      reply('telemetry', { result: 'ok' });
      reply('proof', { proof: data.validate });
    }, () => { reply('telemetry', { result: 'cancelled' }); statusText.textContent = '你已关闭滑块，可点击按钮重新显示。'; }, error => {
      const code = Number.isFinite(error?.errorCode) ? error?.errorCode : 'unknown';
      statusText.textContent = '原厂验证组件未能加载（代码 ' + code + '），请在查询窗口重新获取验证码。'; reply('telemetry', { result: 'error' }); reply('error');
    });
  } catch {
    statusText.textContent = '原厂验证组件未能加载，请在查询窗口重新获取验证码。'; reply('telemetry', { result: 'error' }); reply('error');
  }
});
reopenButton.addEventListener('click', () => { reply('telemetry', { result: 'start' }); instance?.popupShow(); });
window.addEventListener('error', () => reply('telemetry', { result: 'error' }));
window.addEventListener('unhandledrejection', () => reply('telemetry', { result: 'error' }));
window.addEventListener('pagehide', () => instance?.destroy());
parent.postMessage({ channel: 'pioneer-warranty', kind: 'ready' }, '*');
