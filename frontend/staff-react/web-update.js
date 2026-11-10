// The module entry runs after HTML parsing, when the plugin's notification
// container exists. Its default early check can otherwise race the parser.
window.pluginWebUpdateNotice_?.checkUpdate();

// Failed dynamic imports do not reliably emit the resource errors watched by
// the plugin. Ask it to check the version and show its normal notification.
// Refresh stays user-initiated so existing beforeunload guards protect drafts
// (including hidden editors), without an automatic reload loop.
window.addEventListener('vite:preloadError', () => {
  window.pluginWebUpdateNotice_?.checkUpdate();
});
