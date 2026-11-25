import { Linter, SourceCode } from 'eslint';
import { transformSync } from 'esbuild';

const linter = new Linter();
export function runtimeStateErrors(source: string, { typescript = false } = {}) {
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
            const sourceCode = context.sourceCode;
            if (!(sourceCode instanceof SourceCode)) throw new Error('Expected JavaScript source code');
            let scope: ReturnType<SourceCode['getScope']> | null = sourceCode.getScope(node);
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
