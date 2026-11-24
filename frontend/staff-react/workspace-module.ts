import type { ComponentType } from 'react';
import { createElement } from 'react';

// Import code once, without mounting a page or starting any business requests.
// Reading an already prepared module is synchronous: React does not have to
// replace the destination with a Suspense fallback for a resolved promise.
export function workspaceModule<P extends object, K extends string>(
  importModule: () => Promise<Record<K, ComponentType<P>>>,
  exportName: K
) {
  let component: ComponentType<P> | undefined, error: unknown, promise: Promise<void> | undefined;
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
  function Page(props: P) {
    if (error) throw error;
    if (!component) throw preload();
    return createElement(component, props);
  }
  return { Page, preload, ready: () => Boolean(component || error) };
}
