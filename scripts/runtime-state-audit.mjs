import { Linter } from 'eslint';
import { transformSync } from 'esbuild';

const linter = new Linter();
export function runtimeStateErrors(source, { typescript = false } = {}) {
  // Inspect the emitted runtime semantics, keeping the same state rule for
  // JavaScript and TypeScript instead of excluding backend TS from the audit.
  if (typescript) source = transformSync(source, { loader:'ts',target:'esnext',format:'esm' }).code;
  return linter.verify(source, {
    plugins: { architecture: { rules: {
      'no-global-map': {
        meta: { schema: [] },
        create(context) {
          return { NewExpression(node) {
            if (node.callee.type !== 'Identifier' || node.callee.name !== 'Map') return;
            let scope = context.sourceCode.getScope(node);
            while (scope) {
              if (scope.type === 'function') return;
              scope = scope.upper;
            }
            context.report({ node, message: 'Runtime Map state must be created inside a request or explicit factory.' });
          } };
        }
      }
    } } },
    rules: { 'architecture/no-global-map': 'error' }
  }).filter(message => message.severity === 2);
}
