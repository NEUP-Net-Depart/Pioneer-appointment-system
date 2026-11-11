import { pendingEditors } from './useUnsavedChanges.js';

const updateNotice = window.pluginWebUpdateNotice_;
if (updateNotice) {
  updateNotice.onClickRefresh = () => {
    if (pendingEditors({ includeHidden: true }).length) {
      window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: '__refresh__' }));
    } else window.location.reload();
  };
}

// The module entry runs after HTML parsing, when the plugin's notification
// container exists. Its default early check can otherwise race the parser.
updateNotice?.checkUpdate();

// Failed dynamic imports do not reliably emit the resource errors watched by
// the plugin. Ask it to check the version and show its normal notification.
// The refresh callback above uses the workspace's save/discard flow for drafts,
// including hidden editors. Version checks never reload automatically.
window.addEventListener('vite:preloadError', () => {
  window.pluginWebUpdateNotice_?.checkUpdate();
});
