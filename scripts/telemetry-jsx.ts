import { parseSync, traverse, types as t } from '@babel/core';
import { CONTROL_COMPONENTS } from '../shared/telemetry-controls.ts';

const native = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'form',
  'dialog',
  'details',
  'summary'
]);
const roles = new Set([
  'button',
  'combobox',
  'spinbutton',
  'slider',
  'option',
  'listbox',
  'dialog',
  'tooltip'
]);

type JsxAttributeValue = t.JSXAttribute['value'];

interface JsxControl {
  tag: string;
  attributes: Record<string, JsxAttributeValue>;
  at: number;
  line: number;
  id: string;
  expression: string;
  opening: string;
}

// Parse complete JSX openings: callbacks containing `>` must not hide later attributes.
export function jsxControls(source: string): JsxControl[] {
  const output: JsxControl[] = [];
  const ast = parseSync(source, {
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] }
  });
  if (!ast) throw new Error('Cannot parse JSX controls');
  traverse(ast, {
    JSXOpeningElement({ node }) {
      const tag = t.isJSXIdentifier(node.name) ? node.name.name : '';
      const attributes = Object.fromEntries(
        node.attributes
          .filter((attr) => t.isJSXAttribute(attr))
          .flatMap(attr => t.isJSXIdentifier(attr.name) ? [[attr.name.name, attr.value] as const] : [])
      );
      const track = attributes['data-track'];
      const role = attributes.role;
      if (!native.has(tag) && !(t.isStringLiteral(role) && roles.has(role.value)) &&
          !Object.hasOwn(CONTROL_COMPONENTS, tag) && !track) return;
      const loc = node.loc;
      if (!loc || node.name.end == null || node.start == null || node.end == null)
        throw new Error('Missing JSX source locations');
      output.push({
        tag,
        attributes,
        at: node.name.end,
        line: loc.start.line,
        id: t.isStringLiteral(track) ? track.value : '',
        expression: t.isJSXExpressionContainer(track)
          ? source.slice(track.expression.start ?? 0, track.expression.end ?? 0)
          : '',
        opening: source.slice(node.start, node.end)
      });
    }
  });
  return output;
}
