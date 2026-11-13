import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const MINI_THEME = read('./brand-theme.css');
const WEB_THEME = read('../../../web/src/app/cau-chuyen/brand-theme.css');
const WEB_MINI_CSS = read('../../../web/src/components/mini/mini.css');

/** Mọi khai báo `--color-brand*` (gồm `--color-brandmap-*`) thành danh sách [tên, giá trị], giữ thứ tự và cả bản trùng tên. */
function brandDecls(css: string): Array<[string, string]> {
  return [...css.matchAll(/(--color-brand[a-z0-9-]*)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim().replace(/\s+/g, ' ')]);
}

const asMap = (decls: Array<[string, string]>) => Object.fromEntries(decls);

describe('--color-brand-* của Mini App và web không trôi lệch (T4/T5)', () => {
  const mini = brandDecls(MINI_THEME);
  const web = brandDecls(WEB_THEME);
  const webMini = brandDecls(WEB_MINI_CSS);

  it('bảng màu có thật (đủ 11 nhãn, gradient, bản đồ gỗ), không khai trùng tên trong một file', () => {
    expect(mini.length).toBeGreaterThan(40);
    expect(new Set(mini.map(([n]) => n)).size).toBe(mini.length);
    expect(new Set(web.map(([n]) => n)).size).toBe(web.length);
    for (const id of ['visante', 'polang', 'cobote', 'fuwa3e', 'babycare', 'umikai', 'bhnong', 'sokfram', 'leplateau', 'moshav', 'hector']) {
      expect(asMap(mini)[`--color-brand-${id}`], id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('brand-theme.css của Mini App và của web (cau-chuyen) trùng từng tên và từng giá trị', () => {
    expect(asMap(web)).toEqual(asMap(mini));
  });

  it('mini.css của web khai các màu nhãn y hệt brand-theme.css của Mini App (không tự đặt thêm màu lạ)', () => {
    const miniMap = asMap(mini);
    expect(webMini.length).toBeGreaterThan(0);
    for (const [name, value] of webMini) {
      expect(miniMap[name], `${name} có ở mini.css nhưng không có ở brand-theme.css của Mini App`).toBeDefined();
      expect(value, name).toBe(miniMap[name]);
    }
  });
});
