import { createElement } from 'react';

// Import code once, without mounting a page or starting any business requests.
// Reading an already prepared module is synchronous: React does not have to
// replace the destination with a Suspense fallback for a resolved promise.
export function workspaceModule(importModule, exportName) {
  let component, error, promise;
  function preload() {
    if (!promise) {
      promise = importModule().then(
        (module) => {
          component = module[exportName];
        },
        (failure) => {
          error = failure;
          throw failure;
        }
      );
    }
    return promise;
  }
  function Page(props) {
    if (error) throw error;
    if (!component) throw preload();
    return createElement(component, props);
  }
  return { Page, preload, ready: () => Boolean(component || error) };
}
