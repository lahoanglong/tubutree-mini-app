import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Vùng bấm tự làm (div/Box/Text có onClick) phải là control thật với bàn phím và trình đọc màn hình (D8-8): có role,
 * thành điểm dừng Tab và nhận Enter/Space. Cách gọn nhất là role + `{...rowKeyboardProps()}` (ui/row-keyboard.ts).
 * Quét cây JSX của các file D8-8 liệt kê (trừ group-buy*, gói khác).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  'components/flash-sale.tsx',
  'pages/cart.tsx',
  'pages/checkout.tsx',
  'pages/order-detail.tsx',
  'pages/product-detail.tsx',
];

const GENERIC_TAGS = new Set(['div', 'span', 'p', 'li', 'tr', 'section', 'Box', 'Text']);

function weak(file: string): string[] {
  const src = fs.readFileSync(path.join(here, file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bad: string[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxOpeningElement(node) ? node : null;
    if (opening && GENERIC_TAGS.has(opening.tagName.getText(sf))) {
      const props = opening.attributes.properties;
      const names = props.filter(ts.isJsxAttribute).map((a) => a.name.getText(sf));
      const spreadsKeyboard = props.some((p) => ts.isJsxSpreadAttribute(p) && p.expression.getText(sf).includes('rowKeyboardProps'));
      // aria-hidden: lối tắt trang trí cho chuột, đã có control thật cùng đích ngay bên cạnh.
      if (names.includes('onClick') && !names.includes('aria-hidden')) {
        const hasRole = names.includes('role');
        const focusable = names.includes('tabIndex') || spreadsKeyboard;
        const keyed = names.includes('onKeyDown') || spreadsKeyboard;
        if (!hasRole || !focusable || !keyed) {
          const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1;
          bad.push(`${file}:${line} <${opening.tagName.getText(sf)}> role=${hasRole} tab=${focusable} key=${keyed}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bad;
}

describe('vùng bấm không phải <button> có role + bàn phím (D8-8)', () => {
  it.each(FILES)('%s', (file) => {
    expect(weak(file)).toEqual([]);
  });
});
