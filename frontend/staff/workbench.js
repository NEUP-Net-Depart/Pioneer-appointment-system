import { $, $$ } from '/shared/utils.js';
import { roleLabels } from '/shared/constants.js';

// The shell owns account navigation and overlays; scan.js owns the repair flow.
export function initWorkbench({ onSettings, onAdmin, onBack, onOverlay }) {
  const overlay = $('#workbench-profile-dialog'), shell = $('#app-shell');
  let scrollY = 0, returnFocus;
  function close(resume = true) {
    if (overlay.hidden) return;
    overlay.hidden = true;
    shell.inert = false; shell.removeAttribute('aria-hidden');
    document.body.classList.remove('workbench-dialog-open'); document.body.style.removeProperty('top');
    window.scrollTo({ top: scrollY, behavior: 'auto' });
    $('#workbench-profile').setAttribute('aria-expanded', 'false');
    if (resume) { onOverlay(false); returnFocus?.focus({ preventScroll: true }); }
  }
  $('#workbench-profile').addEventListener('click', () => {
    scrollY = window.scrollY; returnFocus = document.activeElement;
    onOverlay(true); overlay.hidden = false;
    shell.inert = true; shell.setAttribute('aria-hidden', 'true');
    document.body.style.top = `-${scrollY}px`; document.body.classList.add('workbench-dialog-open');
    $('#workbench-profile').setAttribute('aria-expanded', 'true');
    $('#workbench-profile-close').focus({ preventScroll: true });
  });
  $('#workbench-profile-close').addEventListener('click', () => close());
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const controls = $$('button:not([disabled])', overlay).filter(button => !button.hidden);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  // The focus guard also supports embedded browsers without inert.
  document.addEventListener('focusin', event => {
    if (!overlay.hidden && !overlay.contains(event.target)) $('#workbench-profile-close').focus();
  });
  $('#workbench-password').addEventListener('click', () => { close(false); onSettings(); });
  $('#workbench-admin').addEventListener('click', () => { close(false); onAdmin(); });
  $('#workbench-settings-back').addEventListener('click', onBack);
  $('#workbench-logout').addEventListener('click', () => { close(false); $('#logout-btn').click(); });
  return {
    profile(user) {
      $('#workbench-profile-name').textContent = user.name || roleLabels[user.role];
      $('#workbench-profile-role').textContent = `${roleLabels[user.role]} · ${user.homeCampus || (user.authorizedCampuses || []).join(' / ')}校区`;
      $('#scan-account').textContent = `账号 ${user.account}`;
      $('#workbench-admin').hidden = !['admin', 'superadmin'].includes(user.role);
    },
    show(enabled, settings = false) {
      $('#management-header').hidden = enabled;
      $('#workbench-header').hidden = !enabled;
      $('#workbench-settings-back').hidden = !settings;
      $('#workbench-subtitle').textContent = settings ? '账号安全' : '维修工作台';
      document.body.classList.toggle('workbench-mode', enabled);
      document.body.classList.toggle('workbench-settings', settings);
    },
    clear() { close(false); this.show(false); }
  };
}
