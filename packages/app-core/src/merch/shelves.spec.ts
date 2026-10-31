import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHELVES, applyShelfDedupe, shelf } from './shelves';

const routeMap = JSON.parse(readFileSync(fileURLToPath(new URL('../route-map.json', import.meta.url)), 'utf8')) as {
  routes: { items: { miniapp: string }[] }[];
};
const MINIAPP_ROUTES = new Set(routeMap.routes.flatMap((g) => g.items.map((i) => i.miniapp)));

// Route do gói sau tạo (P12 `/flash-sale`); route-map.json chỉ nhận dòng khi app.tsx có <Route>, nên gói này chưa thêm được.
// Gói tạo route xoá dòng tương ứng ở đây.
const PLANNED_ROUTES = ['/flash-sale'];

const LAYOUT_CAP = { rail: 10, line: 10, grid: 12, feed: 100 } as const;

const items = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((x) => x.id);
const many = (prefix: string, n: number) => items(...Array.from({ length: n }, (_, i) => `${prefix}${i}`));

describe('SHELVES: luật của sổ kệ', () => {
  it('mọi kệ có maxItems và minItems hợp lệ, trong trần của bố cục', () => {
    for (const s of SHELVES) {
      expect(Number.isInteger(s.maxItems) && s.maxItems > 0, `${s.id} maxItems`).toBe(true);
      expect(Number.isInteger(s.minItems) && s.minItems > 0, `${s.id} minItems`).toBe(true);
      expect(s.minItems, `${s.id} min<=max`).toBeLessThanOrEqual(s.maxItems);
      expect(s.maxItems, `${s.id} trần ${s.layout}`).toBeLessThanOrEqual(LAYOUT_CAP[s.layout]);
    }
  });

  it('id duy nhất; shelf(id) trả đúng kệ; id lạ ném lỗi', () => {
    expect(new Set(SHELVES.map((s) => s.id)).size).toBe(SHELVES.length);
    for (const s of SHELVES) expect(shelf(s.id)).toBe(s);
    expect(() => shelf('home.khong-co')).toThrow(/home\.khong-co/);
  });

  it('seeAllRoute có trong route-map.json (trừ route gói sau sẽ tạo)', () => {
    for (const s of SHELVES) {
      if (s.seeAllRoute === null || PLANNED_ROUTES.includes(s.seeAllRoute)) continue;
      expect(MINIAPP_ROUTES.has(s.seeAllRoute), `${s.id} → ${s.seeAllRoute}`).toBe(true);
    }
  });

  it('không màn nào có hai kệ cùng ý định', () => {
    const seen = new Set<string>();
    for (const s of SHELVES) {
      const key = `${s.screen}|${s.intent}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('Trang chủ có tối đa 4 kệ hàng (không tính lưới vô tận; khách mới không có Mua lại)', () => {
    const rows = (kind: 'returning' | 'new') =>
      SHELVES.filter((s) => s.screen === 'home' && s.layout !== 'feed' && !(kind === 'new' && s.id === 'home.purchased'));
    expect(rows('returning').length).toBeLessThanOrEqual(4);
    expect(rows('new').length).toBeLessThanOrEqual(4);
  });

  it('khai đúng các kệ Trang chủ theo kế hoạch', () => {
    const row = (id: string) => {
      const s = shelf(id);
      return [s.layout, s.maxItems, s.minItems, s.dedupeRank, s.seeAllRoute];
    };
    expect(row('home.flash')).toEqual(['rail', 8, 3, 1, '/flash-sale']);
    expect(row('home.purchased')).toEqual(['line', 10, 1, 2, '/orders']);
    expect(row('home.combos')).toEqual(['rail', 4, 2, 3, null]);
    expect(row('home.bestSellers')).toEqual(['rail', 10, 3, 4, '/best-sellers']);
    expect(row('home.suggest')).toEqual(['feed', 100, 4, 6, '/browse']);
    expect(shelf('offers.flash').maxItems).toBe(4);
    expect(shelf('pdp.combos').maxItems).toBe(2);
    expect(shelf('pdp.addons').maxItems).toBe(3);
  });
});

describe('applyShelfDedupe', () => {
  it('kệ hạng cao chiếm món trước dù đứng sau trong mảng đầu vào; kết quả giữ thứ tự đầu vào', () => {
    const out = applyShelfDedupe([
      { id: 'home.suggest', items: items('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j') },
      { id: 'home.flash', items: items('a', 'b', 'c') },
      { id: 'home.bestSellers', items: items('b', 'c', 'd', 'e', 'f') },
    ]);
    expect(out.map((s) => s.id)).toEqual(['home.suggest', 'home.flash', 'home.bestSellers']);
    expect(ids(out[1]!.items)).toEqual(['a', 'b', 'c']);
    expect(ids(out[2]!.items)).toEqual(['d', 'e', 'f']);
    expect(ids(out[0]!.items)).toEqual(['g', 'h', 'i', 'j']);
  });

  it('cắt theo maxItems sau khi loại trùng, nên món bị loại không làm kệ hụt', () => {
    const out = applyShelfDedupe([
      { id: 'home.flash', items: items('a', 'b', 'c') },
      { id: 'home.bestSellers', items: [...items('a', 'b'), ...many('x', 12)] },
    ]);
    expect(out[1]!.items).toHaveLength(10);
    expect(ids(out[1]!.items)[0]).toBe('x0');
    expect(applyShelfDedupe([{ id: 'home.flash', items: many('f', 12) }])[0]!.items).toHaveLength(8);
  });

  it('id lặp trong chính một kệ chỉ giữ một', () => {
    const out = applyShelfDedupe([{ id: 'home.bestSellers', items: items('b', 'b', 'c', 'd', 'e') }]);
    expect(ids(out[0]!.items)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('kệ dưới minItems trả [] và KHÔNG giữ món: kệ xếp sau vẫn hiện các món đó', () => {
    const out = applyShelfDedupe([
      { id: 'home.flash', items: items('a', 'b') },
      { id: 'home.bestSellers', items: items('a', 'b', 'c', 'd') },
    ]);
    expect(out[0]!.items).toEqual([]);
    expect(ids(out[1]!.items)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('kệ chỉ còn dưới minItems vì bị loại trùng cũng về []', () => {
    const out = applyShelfDedupe([
      { id: 'home.flash', items: items('a', 'b', 'c') },
      { id: 'home.bestSellers', items: items('a', 'b', 'c', 'd', 'e') },
    ]);
    expect(out[1]!.items).toEqual([]);
  });

  it('kệ không có hạng (dedupeRank null) không loại, không chiếm, chỉ bị cắt maxItems', () => {
    const out = applyShelfDedupe([
      { id: 'pdp.boughtTogether', items: items('a', 'b', 'c', 'd') },
      { id: 'pdp.addons', items: items('a', 'b', 'c', 'd', 'e') },
    ]);
    expect(ids(out[0]!.items)).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(out[1]!.items)).toEqual(['a', 'b', 'c']);
  });

  it('mảng rỗng và kệ rỗng không ném lỗi', () => {
    expect(applyShelfDedupe([])).toEqual([]);
    expect(applyShelfDedupe([{ id: 'home.flash', items: [] }])).toEqual([{ id: 'home.flash', items: [] }]);
  });

  it('id không có trong sổ kệ thì ném lỗi to', () => {
    expect(() => applyShelfDedupe([{ id: 'flash', items: items('a') }])).toThrow(/flash/);
  });

  it('không đổi mảng vào', () => {
    const input = [{ id: 'home.flash', items: items('a', 'b', 'c') }, { id: 'home.bestSellers', items: items('a', 'b', 'c', 'd') }];
    const copy = JSON.parse(JSON.stringify(input));
    applyShelfDedupe(input);
    expect(input).toEqual(copy);
  });
});
