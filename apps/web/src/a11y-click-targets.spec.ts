import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Vùng bấm tự làm (div/Box/Text có onClick) phải là control thật với bàn phím và trình đọc màn hình (D8-8): có role,
 * thành điểm dừng Tab và nhận Enter/Space. Ở web cách đúng là `<button>`/`<Link>`; nếu buộc phải dùng
 * phần tử chung thì role + tabIndex + onKeyDown. Quét cây JSX của các file tương ứng danh sách D8-8 của Mini App (chi tiết sản phẩm,
 * giờ vàng, giỏ, thanh toán, chi tiết đơn).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  'components/home/flash-sale.tsx',
  'components/flash-price.tsx',
  'components/pdp-selection.tsx',
  'app/san-pham/[slug]/page.tsx',
  'app/san-pham/[slug]/pdp-extras.tsx',
  'app/san-pham/[slug]/pdp-sections.tsx',
  'app/gio-hang/page.tsx',
  'app/thanh-toan/page.tsx',
  'app/tai-khoan/don-hang/[code]/page.tsx',
];

const GENERIC_TAGS = new Set(['div', 'span', 'p', 'li', 'tr', 'section', 'article', 'img']);

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
