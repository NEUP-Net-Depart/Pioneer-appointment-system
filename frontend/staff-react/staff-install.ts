import { useSyncExternalStore } from 'react';

type InstallPrompt = Event & { prompt: () => Promise<unknown> };
const displayMode = window.matchMedia('(display-mode: standalone)');
const browser = navigator as Navigator & { standalone?: boolean };
let installPrompt: InstallPrompt | undefined;
let prompting = false;
let installed = false;

// Capture the browser event even when the staff sign-in form is still open.
window.addEventListener('beforeinstallprompt', (event) => {
  const candidate = event as InstallPrompt;
  if (typeof candidate.prompt !== 'function') return;
  event.preventDefault();
  installPrompt = candidate;
});

window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  installed = true;
});

function subscribe(callback: () => void) {
  displayMode.addEventListener('change', callback);
  window.addEventListener('appinstalled', callback);
  return () => {
    displayMode.removeEventListener('change', callback);
    window.removeEventListener('appinstalled', callback);
  };
}

function isInstalled() {
  return installed || displayMode.matches || browser.standalone === true;
}

export function useStaffAppInstalled() {
  return useSyncExternalStore(subscribe, isInstalled);
}

export async function showStaffInstallPrompt() {
  if (isInstalled() || prompting) return true;
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = undefined;
  prompting = true;
  try {
    await prompt.prompt();
    return true;
  } catch {
    return false;
  } finally {
    prompting = false;
  }
}

export function staffInstallInstructions() {
  if (
    typeof browser.standalone === 'boolean' ||
    /iPhone|iPad|iPod/i.test(browser.userAgent) ||
    (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1)
  ) {
    return '在 Safari 中打开当前页面，点按共享按钮，选择「添加到主屏幕」。如果看到「作为网页 App 打开」开关，请将其打开，然后点按「添加」。';
  }
  if (/Android/i.test(browser.userAgent)) {
    return '在 Chrome 中打开当前页面，点按右上角「⋮」，选择「安装应用」或「添加到主屏幕」。如果下一步提供「安装」，请选择它。';
  }
  return '打开浏览器菜单，查看是否提供「安装应用」或「添加到主屏幕」。如果没有这些选项，可以继续在浏览器中使用。';
}
