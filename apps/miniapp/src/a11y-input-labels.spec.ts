import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Ô nhập chỉ có placeholder thì mất tên khi gõ và trình đọc màn hình không đọc được (D8-9). Quét cây JSX của các
 * file đã sửa: mỗi Input/Input.Search/Input.TextArea/<input> phải có tên truy cập, hoặc nằm trong <Field label>
 * (Field gắn <label htmlFor>), hoặc tự có prop `label`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  'components/affiliate/ctv-order-sheet.tsx',
  'components/community/product-picker.tsx',
  'components/reviews-section.tsx',
  'components/avatar-crop-modal.tsx',
  'pages/storefront-builder.tsx',
  'pages/checkout.tsx',
];

const INPUT_TAGS = new Set(['Input', 'Input.Search', 'Input.TextArea', 'input', 'textarea']);

function unlabelled(file: string): string[] {
  const src = fs.readFileSync(path.join(here, file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bad: string[] = [];
  const visit = (node: ts.Node, insideField: boolean) => {
    let inside = insideField;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'Field') inside = true;
    const opening = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxOpeningElement(node) ? node : null;
    if (opening && INPUT_TAGS.has(opening.tagName.getText(sf))) {
      const names = opening.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText(sf));
      const named = names.some((n) => n === 'aria-label' || n === 'aria-labelledby' || n === 'label');
      if (!named && !inside) bad.push(`${file}:${sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, (c) => visit(c, inside));
  };
  visit(sf, false);
  return bad;
}

describe('ô nhập có tên truy cập (D8-9)', () => {
  it.each(FILES)('%s: không có ô nhập chỉ dựa vào placeholder', (file) => {
    expect(unlabelled(file)).toEqual([]);
  });
});
