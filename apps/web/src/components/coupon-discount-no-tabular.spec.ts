import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Ô số giảm của hàng mã (`data-testid="coupon-discount"`) KHÔNG được dùng số đều (tabular-nums / tubu-nums / fontVariantNumeric): số đều rộng thêm khoảng 1px
 * trên phông CI Linux và hàng mã ở 320px mất khoảng tới nút "Thay đổi" (còn 11,0px, cần >= 12; `coupon-row-checkout-320.web.spec.ts`). Lỗi đã lặp ở W38A, W71A và W130.
 * Số đều là thuộc tính kế thừa nên chỉ soi thẻ mang testid là chưa đủ. Cổng soi ba chỗ:
 *  - thẻ mang testid và mọi thẻ con bên trong nó;
 *  - mọi thẻ cha, đi qua cả biến/hàm cùng tệp chứa JSX (`const sheetRow = (<button>…</button>)` rồi `{sheetRow}`, hoặc `couponBox(true)`): nơi biến được dùng
 *    cũng được tính vào chuỗi cha;
 *  - tên class đặt `font-variant-numeric: tabular-nums` trong CSS (web và Mini App): danh sách được đọc thẳng từ các tệp .css nên class mới tự vào cổng.
 * Giới hạn: không đi theo thành phần ở tệp khác. Hai trang web gọi `<CouponBox>` (giỏ hàng, thanh toán) vì vậy được quét riêng ở bảng BOX_SITES.
 * Số vị trí tìm thấy được khoá để cổng không đậu rỗng khi ai đó đổi tên hay chuyển ô.
 */
const root = join(__dirname, '../../../..');
const DISCOUNT_SITES: readonly (readonly [file: string, count: number])[] = [
  ['apps/web/src/components/coupon-box.tsx', 2],
  ['apps/miniapp/src/pages/cart.tsx', 1],
  ['apps/miniapp/src/pages/checkout.tsx', 1],
];
const BOX_SITES: readonly (readonly [file: string, count: number])[] = [
  ['apps/web/src/app/gio-hang/page.tsx', 1],
  ['apps/web/src/app/thanh-toan/page.tsx', 1],
];
const CSS_ROOTS = ['apps/web/src', 'apps/miniapp/src'];
const TESTID_VALUE = 'coupon-discount';
const STATIC_FORBIDDEN = ['tabular-nums', 'tubu-nums', 'fontVariantNumeric', 'font-variant-numeric'];

/** Tên class mà một luật CSS gán số đều: lấy các class ở khối chọn cuối của từng bộ chọn (`.a .b:hover` => `b`). Luật `inherit` hay `normal` không tính. */
function tabularClassesFromCss(css: string): string[] {
  const out = new Set<string>();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(rule)) {
    if (!/font-variant-numeric\s*:[^;}]*tabular-nums/.test(m[2]!)) continue;
    for (const selector of m[1]!.split(',')) {
      const last = selector.replace(/\([^)]*\)/g, '').trim().split(/[\s>+~]+/).pop() ?? '';
      for (const c of last.matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(c[1]!);
    }
  }
  return [...out].sort();
}

function loadTabularClasses(): string[] {
  const out = new Set<string>();
  for (const dir of CSS_ROOTS) {
    for (const rel of readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })) {
      if (!rel.endsWith('.css') || rel.includes('node_modules')) continue;
      for (const c of tabularClassesFromCss(readFileSync(join(root, dir, rel), 'utf8'))) out.add(c);
    }
  }
  return [...out].sort();
}

const TABULAR_CLASSES = loadTabularClasses();
const FORBIDDEN = new RegExp(`(?<![\\w-])(?:${[...STATIC_FORBIDDEN, ...TABULAR_CLASSES].join('|')})(?![\\w-])`);

interface Site {
  /** Chữ thuộc tính của thẻ được quét. */
  self: string;
  /** Chữ thuộc tính của mọi thẻ cha, kể cả nơi biến/hàm cùng tệp chứa thẻ được dùng. */
  above: string[];
  /** Chữ thuộc tính của mọi thẻ con, kể cả JSX trong biến cùng tệp mà thẻ nhắc tới. */
  below: string[];
  /** Dòng (tính từ 1) của thẻ được quét, để thông báo lỗi chỉ đúng chỗ. */
  line: number;
}

type Matcher = (opening: ts.JsxOpeningLikeElement) => boolean;

const openingOf = (node: ts.Node): ts.JsxOpeningLikeElement | undefined =>
  ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;

const isTestId = (attr: ts.JsxAttributeLike): boolean => {
  if (!ts.isJsxAttribute(attr) || attr.name.getText() !== 'data-testid' || attr.initializer === undefined) return false;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text === TESTID_VALUE;
  const expr = ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
  return expr !== undefined && ts.isStringLiteralLike(expr) && expr.text === TESTID_VALUE;
};

const byTestId: Matcher = (o) => o.attributes.properties.some(isTestId);
const byTag =
  (name: string): Matcher =>
  (o) =>
    o.tagName.getText() === name;

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

/** Biến và hàm khai báo cùng tệp, theo tên (tên trùng thì giữ khai báo gặp đầu tiên). */
function declarations(sf: ts.SourceFile): Map<string, ts.Node> {
  const map = new Map<string, ts.Node>();
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && !map.has(n.name.text)) map.set(n.name.text, n);
    else if (ts.isFunctionDeclaration(n) && n.name && !map.has(n.name.text)) map.set(n.name.text, n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return map;
}

const declaredName = (node: ts.Node): ts.Identifier | undefined =>
  ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) ? node.name : ts.isFunctionDeclaration(node) ? node.name : undefined;

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

function findSites(source: string, match: Matcher = byTestId, fileName = 'inline.tsx'): Site[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const consts = constTexts(sf);
  const decls = declarations(sf);
  const textOf = (o: ts.JsxOpeningLikeElement) => attributeText(o, sf, consts);

  const identifiersNamed = (name: string, except: ts.Node): ts.Node[] => {
    const found: ts.Node[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === name && n !== except) found.push(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  };

  const above = (start: ts.Node): string[] => {
    const out: string[] = [];
    const seen = new Set<ts.Node>();
    const walk = (from: ts.Node | undefined): void => {
      for (let p = from; p; p = p.parent) {
        const o = openingOf(p);
        if (o) out.push(textOf(o));
        const name = declaredName(p);
        if (name && !seen.has(p)) {
          seen.add(p);
          for (const ref of identifiersNamed(name.text, name)) walk(ref);
        }
      }
    };
    walk(start.parent);
    return out;
  };

  const below = (start: ts.Node): string[] => {
    const out: string[] = [];
    const seen = new Set<ts.Node>();
    const walk = (n: ts.Node): void => {
      ts.forEachChild(n, (c) => {
        const o = openingOf(c);
        if (o) out.push(textOf(o));
        if (ts.isIdentifier(c)) {
          const d = decls.get(c.text);
          if (d && !seen.has(d)) {
            seen.add(d);
            walk(d);
          }
        }
        walk(c);
      });
    };
    walk(start);
    return out;
  };

  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    const opening = openingOf(node);
    if (opening && match(opening)) {
      sites.push({ self: textOf(opening), above: above(node), below: below(node), line: sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

const offending = (sites: readonly Site[]): Site[] => sites.filter((s) => [s.self, ...s.above, ...s.below].some((t) => FORBIDDEN.test(t)));
const scan = (file: string, match: Matcher): Site[] => findSites(readFileSync(join(root, file), 'utf8'), match, file);

describe('coupon-discount không dùng số đều (tabular-nums) ở web và Mini App, kể cả ở thẻ cha và thẻ con', () => {
  it.each(DISCOUNT_SITES)('%s: đủ %i ô coupon-discount; ô, mọi thẻ cha và mọi thẻ con đều không có số đều', (file, count) => {
    const sites = scan(file, byTestId);
    expect(sites, `không thấy đủ ô coupon-discount trong ${file}`).toHaveLength(count);
    expect(offending(sites).map((s) => `${file}:${s.line}`), 'ô coupon-discount (hoặc thẻ cha, thẻ con của nó) đang dùng số đều').toEqual([]);
  });

  it.each(BOX_SITES)('%s: đủ %i chỗ gọi <CouponBox>; thẻ cha của nó không có số đều (CouponBox ở tệp khác, ô con không đi theo được)', (file, count) => {
    const sites = scan(file, byTag('CouponBox'));
    expect(sites, `không thấy đủ chỗ gọi CouponBox trong ${file}`).toHaveLength(count);
    expect(offending(sites).map((s) => `${file}:${s.line}`), 'CouponBox đang nằm trong thẻ có số đều').toEqual([]);
  });

  describe('danh sách class số đều đọc từ CSS', () => {
    it('đọc đúng luật tabular-nums, bỏ luật inherit, chịu được @media và bộ chọn nhiều tầng', () => {
      const css = `
        /* .ghost { font-variant-numeric: tabular-nums; } */
        .a, .b .c:hover { font-variant-numeric: tabular-nums; }
        .d { font-variant-numeric: inherit; }
        .e.f { color: red; font-variant-numeric: tabular-nums }
        @media (min-width: 768px) { .g { font-variant-numeric: tabular-nums; } }
        .h:not(.i) > .j { margin: 0; }
      `;
      expect(tabularClassesFromCss(css)).toEqual(['a', 'c', 'e', 'f', 'g']);
    });

    it('CSS thật của web và Mini App cho ra các class số đều đã biết, không lẫn nút đặt lại về inherit', () => {
      expect(TABULAR_CLASSES.length).toBeGreaterThan(10);
      for (const known of ['tubu-nums', 'tubu-sticky-bar', 'tubu-story', 'tubu-fbt']) expect(TABULAR_CLASSES, `thiếu ${known}`).toContain(known);
      for (const reset of ['tubu-btn', 'tubu-freeship-cta']) expect(TABULAR_CLASSES, `${reset} chỉ đặt inherit, không phải số đều`).not.toContain(reset);
    });
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

    it('bắt số đều ở thẻ con và cháu của ô', () => {
      expect(offending(findSites(`const A = () => <div><span data-testid="coupon-discount"><i className="tabular-nums">x</i></span></div>;`))).toHaveLength(1);
      expect(offending(findSites(`const A = () => <span data-testid="coupon-discount"><b><i style={{ fontVariantNumeric: 'tabular-nums' }}>x</i></b></span>;`))).toHaveLength(1);
    });

    it('bắt số đều ở thẻ con khi nó nằm trong biến JSX cùng tệp', () => {
      expect(offending(findSites(`const amount = <b className="tubu-nums">1</b>; const A = () => <span data-testid="coupon-discount">-{amount}</span>;`))).toHaveLength(1);
    });

    it('bắt số đều ở thẻ cha của nơi dùng biến JSX (kiểu sheetRow của coupon-box.tsx)', () => {
      const src = `
        const A = () => {
          const sheetRow = (<button><span><span data-testid="coupon-discount">x</span></span></button>);
          return <div className="tabular-nums">{sheetRow}</div>;
        };`;
      expect(offending(findSites(src))).toHaveLength(1);
      const wrapped = `
        const A = () => {
          const sheetRow = (<button><span data-testid="coupon-discount">x</span></button>);
          return <section style={{ fontVariantNumeric: 'tabular-nums' }}><div>{open ? sheetRow : null}</div></section>;
        };`;
      expect(offending(findSites(wrapped))).toHaveLength(1);
    });

    it('bắt số đều ở thẻ cha của nơi dùng thành phần hoặc hàm dựng JSX cùng tệp', () => {
      expect(offending(findSites(`const Row = () => <span data-testid="coupon-discount">x</span>; const A = () => <section className="tubu-nums"><Row /></section>;`))).toHaveLength(1);
      expect(offending(findSites(`function Row() { return <span data-testid="coupon-discount">x</span>; } const A = () => <section className="tabular-nums"><Row /></section>;`))).toHaveLength(1);
      expect(offending(findSites(`const row = (s: boolean) => <span data-testid="coupon-discount">x</span>; const A = () => <div className="tabular-nums">{row(true)}</div>;`))).toHaveLength(1);
    });

    it('bắt class số đều lấy từ CSS ở thẻ cha, thẻ con và chính ô', () => {
      expect(offending(findSites(`const A = () => <div className="tubu-sticky-bar"><span data-testid="coupon-discount">x</span></div>;`))).toHaveLength(1);
      expect(offending(findSites(`const A = () => <span data-testid="coupon-discount" className="tubu-story">x</span>;`))).toHaveLength(1);
      expect(offending(findSites(`const A = () => <span data-testid="coupon-discount"><i className="tubu-fbt">x</i></span>;`))).toHaveLength(1);
    });

    it('bắt số đều ở thẻ cha của chỗ gọi <CouponBox>', () => {
      const src = `const couponBox = (s: boolean) => <CouponBox sheet={s} />; const A = () => <aside className="tabular-nums">{couponBox(true)}</aside>;`;
      expect(offending(findSites(src, byTag('CouponBox')))).toHaveLength(1);
    });

    it('nhận testid viết dạng biểu thức chuỗi', () => {
      expect(findSites(`const A = () => <span data-testid={'coupon-discount'}>x</span>;`)).toHaveLength(1);
    });

    it('không báo oan: số đều ở thẻ anh em hay ngoài chuỗi cha không tính', () => {
      expect(offending(findSites(`const A = () => <div><span className="tabular-nums">tổng</span><span data-testid="coupon-discount" className="whitespace-nowrap">x</span></div>;`))).toHaveLength(0);
      expect(offending(findSites(`const A = () => <><p className="tubu-nums">a</p><div><span data-testid="coupon-discount">x</span></div></>;`))).toHaveLength(0);
    });

    it('không báo oan: biến hay thành phần dùng dưới thẻ cha sạch, class đặt lại inherit, tên class chỉ giống một phần', () => {
      const src = `
        const sheetRow = (<button><span data-testid="coupon-discount">x</span></button>);
        const A = () => <div className="mt-3 flex">{sheetRow}</div>;
        const B = () => <p className="tabular-nums">khác</p>;`;
      expect(offending(findSites(src))).toHaveLength(0);
      expect(offending(findSites(`const A = () => <div className="tubu-btn tubu-freeship-cta"><span data-testid="coupon-discount">x</span></div>;`))).toHaveLength(0);
      expect(offending(findSites(`const A = () => <div className="tubu-nums-not"><span data-testid="coupon-discount">x</span></div>;`))).toHaveLength(0);
    });

    it('chỉ đếm đúng testid coupon-discount', () => {
      expect(findSites(`const A = () => <div className="tabular-nums"><span data-testid="coupon-code">x</span></div>;`)).toHaveLength(0);
    });
  });
});
