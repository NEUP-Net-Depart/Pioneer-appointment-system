import { initialize } from './guide.js';
import './simulation/simulator.css';

if (new URLSearchParams(location.search).has('lesson'))
  document.body.classList.add('tutorial-atomic');

if (new URLSearchParams(location.search).get('lesson') === 'activation') {
  const params = new URLSearchParams(location.search);
  params.set('activate', '1');
  history.replaceState(null, '', `${location.pathname}?${params}`);
  sessionStorage.removeItem('pioneerActivationReceipt');
}
sessionStorage.setItem('pioneerToken', 'tutorial-session');
sessionStorage.setItem('pioneerRole', 'technician');
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.pathname.startsWith('/api/') || url.origin !== location.origin)
    return Promise.reject(new Error('教程只使用本地示例数据。'));
  if (url.pathname.startsWith('/assets/')) {
    url.pathname = `${import.meta.env.BASE_URL}${url.pathname.slice(1)}`;
    return nativeFetch(url, options);
  }
  return nativeFetch(input, options);
};
if (navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async () => {
    throw new DOMException('教程使用手工输入演示码，不需要摄像头。', 'NotAllowedError');
  };

await import('../../frontend/staff-react/main.jsx');
initialize().catch((error) => {
  window.parent.postMessage(
    {
      channel: 'pioneer-academy',
      session: new URLSearchParams(location.search).get('session'),
      type: 'error',
      message: error.message
    },
    location.origin
  );
});
