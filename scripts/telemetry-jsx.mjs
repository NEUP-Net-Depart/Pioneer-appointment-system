import { parsers } from 'prettier/plugins/babel';
import { CONTROL_COMPONENTS } from '../shared/telemetry-controls.js';

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

// Parse complete JSX openings: callbacks containing `>` must not hide later attributes.
export function jsxControls(source) {
  const output = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement') {
      const tag = node.name.name;
      const attributes = Object.fromEntries(
        node.attributes
          .filter((attr) => attr.type === 'JSXAttribute')
          .map((attr) => [attr.name.name, attr.value])
      );
      const track = attributes['data-track'];
      if (
        native.has(tag) ||
        roles.has(attributes.role?.value) ||
        CONTROL_COMPONENTS[tag] ||
        track
      ) {
        output.push({
          tag,
          attributes,
          at: node.name.end,
          line: node.loc.start.line,
          id: track?.type === 'StringLiteral' ? track.value : '',
          expression:
            track?.type === 'JSXExpressionContainer'
              ? source.slice(track.expression.start, track.expression.end)
              : '',
          opening: source.slice(node.start, node.end)
        });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  }
  visit(parsers['babel-ts'].parse(source, {}));
  return output;
}
