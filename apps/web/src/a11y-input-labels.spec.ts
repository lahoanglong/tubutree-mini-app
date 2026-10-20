import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Ô nhập chỉ có placeholder thì mất tên khi gõ và trình đọc màn hình không đọc được (D8-9). Quét cây JSX của các file
 * tương ứng với danh sách của `a11y-input-labels.spec.ts` ở Mini App: mỗi <input>/<textarea>/<select> phải có tên truy cập,
 * hoặc nằm trong <Field>/<label> (gắn nhãn), hoặc có `id` để <label htmlFor> trỏ tới.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  'components/affiliate/ctv-order-sheet.tsx',
  'components/affiliate/storefront-builder.tsx',
  'components/affiliate/storefront-sheets.tsx',
  'components/community/product-picker.tsx',
  'components/account/avatar-crop-sheet.tsx',
  'components/recycle/recycle-request.tsx',
  'components/site-search.tsx',
  'app/san-pham/[slug]/product-reviews.tsx',
  'app/thanh-toan/page.tsx',
];

const INPUT_TAGS = new Set(['input', 'textarea', 'select']);
const WRAPPERS = new Set(['Field', 'label']);

function unlabelled(file: string): string[] {
  const src = fs.readFileSync(path.join(here, file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bad: string[] = [];
  const visit = (node: ts.Node, inside: boolean) => {
    let within = inside;
    if (ts.isJsxElement(node) && WRAPPERS.has(node.openingElement.tagName.getText(sf))) within = true;
    const opening = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxOpeningElement(node) ? node : null;
    if (opening && INPUT_TAGS.has(opening.tagName.getText(sf))) {
      const names = opening.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText(sf));
      const typeAttr = opening.attributes.properties.filter(ts.isJsxAttribute).find((a) => a.name.getText(sf) === 'type');
      const hidden = names.includes('hidden') || typeAttr?.initializer?.getText(sf) === '"hidden"';
      const named = names.some((n) => n === 'aria-label' || n === 'aria-labelledby' || n === 'id');
      if (!named && !within && !hidden) bad.push(`${file}:${sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, (c) => visit(c, within));
  };
  visit(sf, false);
  return bad;
}

describe('ô nhập có tên truy cập (D8-9)', () => {
  it.each(FILES)('%s: không có ô nhập chỉ dựa vào placeholder', (file) => {
    expect(unlabelled(file)).toEqual([]);
  });
});
