import { Linter } from 'eslint';

const linter = new Linter();
export function runtimeStateErrors(source) {
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
