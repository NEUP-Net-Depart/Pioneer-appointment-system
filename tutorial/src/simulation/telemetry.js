export const track = () => {};
export const trackPage = () => {};
export const trackRequest = () => {};
export const identifyTelemetry = () => {};
export const resetTelemetry = () => {};
export const reportClientError = (error, code) => {
  if (code === 'REACT_RENDER_ERROR' && error)
    window.dispatchEvent(new CustomEvent('tutorial-render-error', { detail: error.message }));
};
export const recentlyActive = () => true;
