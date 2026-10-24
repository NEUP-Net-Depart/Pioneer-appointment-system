import { Linter } from 'eslint';

const linter = new Linter();
// Audit minified release imports without mistaking quoted UI text for code.
export function importSpecifiers(source) {
  const imports = new Set();
  const messages = linter.verify(source, {
    plugins: { graph: { rules: { imports: {
      meta: { schema: [] },
      create() {
        const add = node => { if (typeof node?.value === 'string') imports.add(node.value); };
        return {
          ImportDeclaration: node => add(node.source),
          ExportNamedDeclaration: node => add(node.source),
          ExportAllDeclaration: node => add(node.source),
          ImportExpression: node => add(node.source)
        };
      }
    } } } },
    rules: { 'graph/imports': 'error' }
  });
  if (messages.some(message => message.fatal)) throw new Error('Cannot audit malformed JavaScript imports');
  return [...imports];
}
