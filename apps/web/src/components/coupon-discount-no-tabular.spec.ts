import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Ô số giảm của hàng mã (`data-testid="coupon-discount"`) KHÔNG được dùng số đều (tabular-nums / tubu-nums / fontVariantNumeric): số đều rộng thêm khoảng 1px
 * trên phông CI Linux và hàng mã ở 320px mất khoảng tới nút "Thay đổi" (còn 11,0px, cần >= 12; `coupon-row-checkout-320.web.spec.ts`). Lỗi đã lặp ở W38A, W71A và W130.
 * Số đều là thuộc tính kế thừa nên gắn ở thẻ cha cũng làm ô con rộng ra: cổng đi ngược cả chuỗi thẻ JSX bao ngoài ô (cùng tệp), không chỉ thẻ mang testid.
 * Cổng quét nguồn ở cả web và Mini App bằng cây cú pháp TypeScript; số vị trí tìm thấy được khoá để cổng không đậu rỗng khi ai đó đổi tên hay chuyển ô.
 */
const root = join(__dirname, '../../../..');
const SITES: readonly (readonly [file: string, count: number])[] = [
  ['apps/web/src/components/coupon-box.tsx', 2],
  ['apps/miniapp/src/pages/cart.tsx', 1],
  ['apps/miniapp/src/pages/checkout.tsx', 1],
];
const TESTID_VALUE = 'coupon-discount';
const FORBIDDEN = /tabular-nums|tubu-nums|fontVariantNumeric|font-variant-numeric/;

interface Site {
  /** Chữ thuộc tính của thẻ mang testid, rồi lần lượt của các thẻ cha từ gần tới xa. */
  chain: readonly string[];
  /** Dòng (tính từ 1) của thẻ mang testid, để thông báo lỗi chỉ đúng chỗ. */
  line: number;
}

const openingOf = (node: ts.Node): ts.JsxOpeningLikeElement | undefined =>
  ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;

const isTestId = (attr: ts.JsxAttributeLike): boolean => {
  if (!ts.isJsxAttribute(attr) || attr.name.getText() !== 'data-testid' || attr.initializer === undefined) return false;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text === TESTID_VALUE;
  const expr = ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
  return expr !== undefined && ts.isStringLiteralLike(expr) && expr.text === TESTID_VALUE;
};

/** Hằng cùng tệp (`const NUMS = 'tabular-nums'`): thuộc tính trỏ vào tên hằng vẫn bị soi theo nội dung hằng (một tầng). */
function constTexts(sf: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) map.set(n.name.text, n.initializer.getText(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return map;
}

/** Chữ của các thuộc tính trên một thẻ, kèm nội dung hằng cùng tệp mà thuộc tính nhắc tới. */
function attributeText(opening: ts.JsxOpeningLikeElement, sf: ts.SourceFile, consts: Map<string, string>): string {
  const parts: string[] = [];
  for (const attr of opening.attributes.properties) {
    parts.push(attr.getText(sf));
    const collect = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && consts.has(n.text)) parts.push(consts.get(n.text)!);
      ts.forEachChild(n, collect);
    };
    collect(attr);
  }
  return parts.join(' ');
}

function findSites(source: string, fileName = 'inline.tsx'): Site[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const consts = constTexts(sf);
  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    const opening = openingOf(node);
    if (opening && opening.attributes.properties.some(isTestId)) {
      const chain: string[] = [attributeText(opening, sf, consts)];
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        const o = openingOf(p);
        if (o) chain.push(attributeText(o, sf, consts));
      }
      sites.push({ chain, line: sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

const offending = (sites: readonly Site[]): Site[] => sites.filter((s) => s.chain.some((t) => FORBIDDEN.test(t)));

describe('coupon-discount không dùng số đều (tabular-nums) ở web và Mini App, kể cả ở thẻ cha', () => {
  it.each(SITES)('%s: đủ %i ô coupon-discount; ô và mọi thẻ cha đều không có số đều', (file, count) => {
    const sites = findSites(readFileSync(join(root, file), 'utf8'), file);
    expect(sites, `không thấy đủ ô coupon-discount trong ${file}`).toHaveLength(count);
    expect(offending(sites).map((s) => `${file}:${s.line}`), 'ô coupon-discount (hoặc thẻ cha của nó) đang dùng số đều').toEqual([]);
  });

  describe('bộ dò', () => {
    it('bắt số đều ngay trên thẻ mang testid (className, style, tubu-nums)', () => {
      expect(offending(findSites(`const A = () => <span data-testid="coupon-discount" className="shrink-0 tabular-nums">x</span>;`))).toHaveLength(1);
      expect(offending(findSites(`const A = () => <Text size="xSmall" data-testid="coupon-discount" style={{ fontVariantNumeric: 'tabular-nums' }}>x</Text>;`))).toHaveLength(1);
      expect(offending(findSites(`const A = () => <span data-testid="coupon-discount" className="tubu-nums">x</span>;`))).toHaveLength(1);
    });

    it('bắt số đều ở thẻ cha trực tiếp và gián tiếp', () => {
      expect(offending(findSites(`const A = () => <div className="tabular-nums"><span data-testid="coupon-discount">x</span></div>;`))).toHaveLength(1);
      expect(offending(findSites(`const A = () => <section style={{ fontVariantNumeric: 'tabular-nums' }}><div><p><span data-testid="coupon-discount">x</span></p></div></section>;`))).toHaveLength(1);
      expect(offending(findSites(`const A = () => <div className="tubu-nums"><b>y</b><Row><span data-testid="coupon-discount" /></Row></div>;`))).toHaveLength(1);
    });

    it('bắt số đều ở thẻ cha khi thuộc tính trỏ vào hằng cùng tệp', () => {
      expect(offending(findSites(`const NUMS = 'tabular-nums'; const A = () => <div className={NUMS}><span data-testid="coupon-discount">x</span></div>;`))).toHaveLength(1);
    });

    it('nhận testid viết dạng biểu thức chuỗi', () => {
      expect(findSites(`const A = () => <span data-testid={'coupon-discount'}>x</span>;`)).toHaveLength(1);
    });

    it('không báo oan: số đều ở thẻ anh em, thẻ con, hay ngoài chuỗi cha không tính', () => {
      expect(offending(findSites(`const A = () => <div><span className="tabular-nums">tổng</span><span data-testid="coupon-discount" className="whitespace-nowrap">x</span></div>;`))).toHaveLength(0);
      expect(offending(findSites(`const A = () => <div><span data-testid="coupon-discount"><i className="tabular-nums">x</i></span></div>;`))).toHaveLength(0);
      expect(offending(findSites(`const A = () => <><p className="tubu-nums">a</p><div><span data-testid="coupon-discount">x</span></div></>;`))).toHaveLength(0);
    });

    it('chỉ đếm đúng testid coupon-discount', () => {
      expect(findSites(`const A = () => <div className="tabular-nums"><span data-testid="coupon-code">x</span></div>;`)).toHaveLength(0);
    });
  });
});
