import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import config from '../tailwind.config';

/**
 * Nhãn ô nhập (chữ trên ô nhập) của khách đọc từ bậc `--type-field-label-*` (12px, 1,33, độ đậm 500) qua lớp `text-field-label`, cùng bậc với
 * `Field` và nhãn Mini App; bậc nhãn chip/huy hiệu (`text-label`, 600) không dùng cho nhãn ô nhập. Quét cây JSX các file có nhãn ô nhập chép
 * từ Mini: mỗi `<label>` bọc hoặc trỏ tới một ô nhập chữ (không phải radio/checkbox, không ẩn bằng `sr-only`) phải mang `text-field-label`
 * trên chính nó hoặc trên phần tử chữ bên trong. Màn quản trị, chủ gian hàng, CTV, nhân viên, đại lý ngoài phạm vi.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  'components/address-form.tsx',
  'components/geo-picker.tsx',
  'components/coupon-box.tsx',
  'app/thanh-toan/invoice-section.tsx',
  'app/thanh-toan/page.tsx',
  'app/tai-khoan/don-hang/[code]/return-request-form.tsx',
  'app/tai-khoan/don-hang/[code]/refund-destination-picker.tsx',
];
const TEXT_INPUTS = new Set(['input', 'textarea', 'select']);

function classText(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, sf: ts.SourceFile): string {
  const attr = node.attributes.properties.filter(ts.isJsxAttribute).find((a) => a.name.getText(sf) === 'className');
  return attr?.initializer ? attr.initializer.getText(sf) : '';
}
const attrOf = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string, sf: ts.SourceFile) =>
  node.attributes.properties.filter(ts.isJsxAttribute).find((a) => a.name.getText(sf) === name)?.initializer?.getText(sf) ?? null;

function wrongLabelsIn(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bad: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'label') {
      let hasTextInput = false;
      let hasChoice = false;
      let ownClasses = classText(node.openingElement, sf);
      const htmlFor = attrOf(node.openingElement, 'htmlFor', sf) !== null;
      const walk = (n: ts.Node) => {
        if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
          const tag = n.tagName.getText(sf);
          if (TEXT_INPUTS.has(tag)) {
            const type = attrOf(n, 'type', sf) ?? '';
            if (/radio|checkbox/.test(type)) hasChoice = true;
            else hasTextInput = true;
          } else if (n !== node.openingElement) ownClasses += ` ${classText(n, sf)}`;
        }
        ts.forEachChild(n, walk);
      };
      ts.forEachChild(node, walk);
      const isFieldLabel = !hasChoice && (hasTextInput || htmlFor) && !/\bsr-only\b/.test(classText(node.openingElement, sf));
      if (isFieldLabel && !ownClasses.includes('text-field-label')) {
        bad.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bad;
}

const wrongLabels = (file: string) => wrongLabelsIn(file, fs.readFileSync(path.join(here, file), 'utf8'));

describe('nhãn ô nhập web: bậc field-label (chép từ Mini App)', () => {
  it('Tailwind có cỡ chữ field-label đọc --type-field-label-* kèm độ đậm', () => {
    const fontSize = (config.theme?.extend as { fontSize: Record<string, unknown> }).fontSize;
    expect(fontSize['field-label']).toEqual(['var(--type-field-label-size)', { lineHeight: 'var(--type-field-label-lh)', fontWeight: 'var(--type-field-label-weight)' }]);
  });

  it.each(FILES)('%s: mọi nhãn ô nhập mang text-field-label', (file) => {
    expect(wrongLabels(file)).toEqual([]);
  });

  it('bộ quét thật sự bắt được nhãn sai (không xanh giả) và bỏ qua radio, checkbox, sr-only', () => {
    const wrong = '<label htmlFor="x" className="text-caption font-medium">Tên</label>';
    const wrapped = '<label className="block"><span className="text-xs">Tên</span><input /></label>';
    const right = '<label className="block"><span className="text-field-label">Tên</span><input /></label>';
    const radio = '<label className="flex"><input type="radio" /><span>Một</span></label>';
    const hidden = '<label htmlFor="q" className="sr-only">Tìm</label>';
    const probe = (jsx: string) => wrongLabelsIn('probe.tsx', `export const A = () => (<>${jsx}</>);`);
    expect(probe(wrong)).toHaveLength(1);
    expect(probe(wrapped)).toHaveLength(1);
    expect([probe(right), probe(radio), probe(hidden)]).toEqual([[], [], []]);
  });
});
