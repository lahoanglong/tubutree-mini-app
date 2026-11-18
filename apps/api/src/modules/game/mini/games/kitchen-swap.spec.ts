import { MINI_GAME_RULES, MINI_KITCHEN_CORNERS, type MiniKitchenCorner, type MiniProductCard } from '@tubutree/shared-types';
import { MINI_GAMES } from '.';
import type { MiniBuildCtx, MiniContentRow, MiniPickCtx } from './game-def';
import { kitchenSwapGame, kitchenSwapReady, kitchenSwapUsable, readKitchenSwapPayload } from './kitchen-swap';

/** Bộ sinh số có hạt giống: pick/build dùng rng nên test phải lặp lại được. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const slugsFor = (id: string) => [`${id}-dung`, `${id}-sai-a`, `${id}-sai-b`];

const payload = (id = 'k1', over: Record<string, unknown> = {}) => ({
  corner: 'kitchen',
  item: 'Chai nước rửa chén 500 ml',
  emoji: '🧴',
  hidden: 'Mỗi chai mới là thêm một vỏ nhựa.',
  options: slugsFor(id).map((slug, i) => ({ slug, fact: `Điều nhãn ${i + 1}` })),
  answer: `${id}-dung`,
  ...over,
});

const row = (id: string, corner: MiniKitchenCorner = 'kitchen', over: Partial<MiniContentRow> = {}): MiniContentRow => ({
  id,
  game: 'kitchen_swap',
  payload: payload(id, { corner }),
  explanation: `Giải thích ${id}`,
  sourceUrl: `https://nguon.example.vn/${id}`,
  productSlug: null,
  ...over,
});

const card = (slug: string, inStock = true): MiniProductCard => ({ slug, name: `Sản phẩm ${slug}`, imageUrl: null, price: 59_000, inStock });
const productsOf = (rows: MiniContentRow[], outOfStock: string[] = []) =>
  new Map(rows.flatMap((r) => slugsFor(r.id)).map((s) => [s, card(s, !outOfStock.includes(s))] as const));

const pickCtx = (rows: MiniContentRow[], over: Partial<MiniPickCtx> = {}): MiniPickCtx => ({
  rng: seeded(7),
  dayKey: '2026-11-18',
  products: productsOf(rows),
  ...over,
});
const buildCtx = (rows: MiniContentRow[], over: Partial<MiniBuildCtx> = {}): MiniBuildCtx => ({
  ...pickCtx(rows),
  sortHazardous: false,
  cardId: (id, side) => `${side}:${id}`,
  ...over,
});

/** Kho đủ 4 góc: mỗi góc 3 món. */
const POOL = MINI_KITCHEN_CORNERS.flatMap((c) => [1, 2, 3].map((n) => row(`${c}-${n}`, c)));

describe('Căn Bếp Xanh: luật', () => {
  it('đăng ký trong MINI_GAMES, ván 3 món, 45 giây', () => {
    expect(MINI_GAMES.kitchen_swap).toBe(kitchenSwapGame);
    expect(MINI_GAME_RULES.kitchen_swap).toEqual({ items: 3, timeLimitMs: 45_000 });
  });
});

describe('kitchenSwapGame.payloadError', () => {
  it('hợp lệ: góc nhà, món, điều giấu, 3 sản phẩm khác nhau kèm điều nhãn, đáp án là một trong 3', () => {
    expect(kitchenSwapGame.payloadError(payload())).toBeNull();
    expect(readKitchenSwapPayload(payload())?.emoji).toBe('🧴');
  });

  it('emoji không bắt buộc', () => {
    const { emoji: _e, ...rest } = payload();
    expect(readKitchenSwapPayload(rest)?.emoji).toBeNull();
    expect(readKitchenSwapPayload({ ...rest, emoji: null })?.emoji).toBeNull();
  });

  it.each([
    ['không phải đối tượng', 'chai nhựa'],
    ['null', null],
    ['góc lạ', payload('k1', { corner: 'garage' })],
    ['thiếu món', payload('k1', { item: '   ' })],
    ['món quá 80 ký tự', payload('k1', { item: 'a'.repeat(81) })],
    ['điều giấu quá 140 ký tự', payload('k1', { hidden: 'b'.repeat(141) })],
    ['emoji rỗng', payload('k1', { emoji: '' })],
    ['2 sản phẩm', payload('k1', { options: payload().options.slice(0, 2) })],
    ['4 sản phẩm', payload('k1', { options: [...payload().options, { slug: 'k1-sai-c', fact: 'x' }] })],
    ['trùng slug', payload('k1', { options: [payload().options[0], payload().options[0], payload().options[1]] })],
    ['slug sai dạng', payload('k1', { options: [{ slug: 'Có Dấu', fact: 'x' }, ...payload().options.slice(1)] })],
    ['điều nhãn quá 140 ký tự', payload('k1', { options: [{ slug: 'k1-dung', fact: 'c'.repeat(141) }, ...payload().options.slice(1)] })],
    ['đáp án ngoài 3 sản phẩm', payload('k1', { answer: 'khac' })],
    ['đáp án không phải chữ', payload('k1', { answer: 0 })],
  ])('sai dạng: %s', (_label, bad) => {
    expect(kitchenSwapGame.payloadError(bad)).toMatch(/Căn Bếp Xanh cần/);
  });
});

describe('kitchenSwapUsable / kitchenSwapReady', () => {
  it('món chỉ dùng được khi cả 3 sản phẩm còn bán và còn hàng', () => {
    const r = row('k1');
    expect(kitchenSwapUsable(r, { products: productsOf([r]) })).toBe(true);
    expect(kitchenSwapUsable(r, { products: productsOf([r], ['k1-sai-b']) })).toBe(false);
    const missing = productsOf([r]);
    missing.delete('k1-dung');
    expect(kitchenSwapUsable(r, { products: missing })).toBe(false);
    expect(kitchenSwapUsable(row('hong', 'kitchen', { payload: { corner: 'kitchen' } }), { products: missing })).toBe(false);
  });

  it('kho cần món dùng được ở ít nhất 3 góc khác nhau', () => {
    const twoCorners = [row('a', 'kitchen'), row('b', 'kitchen'), row('c', 'table')];
    expect(kitchenSwapReady(twoCorners, { products: productsOf(twoCorners) })).toBe(false);
    const three = [...twoCorners, row('d', 'bag')];
    expect(kitchenSwapReady(three, { products: productsOf(three) })).toBe(true);
    expect(kitchenSwapReady(three, { products: productsOf(three, ['d-sai-a']) })).toBe(false);
  });
});

describe('kitchenSwapGame.pick', () => {
  it('3 món ở 3 góc khác nhau, theo thứ tự góc cố định', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const picked = kitchenSwapGame.pick(POOL, pickCtx(POOL, { rng: seeded(seed) }))!;
      expect(picked).toHaveLength(3);
      const corners = picked.map((r) => readKitchenSwapPayload(r.payload)!.corner);
      expect(new Set(corners).size).toBe(3);
      expect(corners).toEqual(MINI_KITCHEN_CORNERS.filter((c) => corners.includes(c)));
    }
  });

  it('mọi góc và mọi món đều có lúc được chọn', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) for (const r of kitchenSwapGame.pick(POOL, pickCtx(POOL, { rng: seeded(seed) }))!) seen.add(r.id);
    expect(seen.size).toBe(POOL.length);
  });

  it('bỏ món có sản phẩm hết hàng; còn dưới 3 góc dùng được thì null', () => {
    const outBathroom = POOL.filter((r) => r.id.startsWith('bathroom')).map((r) => `${r.id}-sai-a`);
    const outBag = POOL.filter((r) => r.id.startsWith('bag')).map((r) => `${r.id}-dung`);
    const ctx = pickCtx(POOL, { products: productsOf(POOL, outBathroom) });
    for (let seed = 1; seed <= 20; seed++) {
      const picked = kitchenSwapGame.pick(POOL, { ...ctx, rng: seeded(seed) })!;
      expect(picked.some((r) => r.id.startsWith('bathroom'))).toBe(false);
    }
    expect(kitchenSwapGame.pick(POOL, pickCtx(POOL, { products: productsOf(POOL, [...outBathroom, ...outBag]) }))).toBeNull();
  });
});

describe('kitchenSwapGame.build', () => {
  it('không lộ đáp án: chỉ món, điều giấu, 3 thẻ sản phẩm đã xáo kèm điều nhãn', () => {
    const rows = [row('t', 'table'), row('k', 'kitchen'), row('b', 'bag')];
    const content = kitchenSwapGame.build(rows, buildCtx(rows));
    expect(content.game).toBe('kitchen_swap');
    if (content.game !== 'kitchen_swap') throw new Error('sai game');
    expect(content.swaps.map((s) => [s.id, s.corner])).toEqual([
      ['t', 'table'],
      ['k', 'kitchen'],
      ['b', 'bag'],
    ]);
    for (const s of content.swaps) {
      expect(s.options.map((o) => o.product.slug).sort()).toEqual(slugsFor(s.id).sort());
      expect(s.options.every((o) => /^Điều nhãn \d$/.test(o.fact))).toBe(true);
      expect(JSON.stringify(s)).not.toMatch(/answer|correct|explanation|sourceUrl|Giải thích/);
    }
  });

  it('thứ tự 3 thẻ đổi theo ván (xáo)', () => {
    const rows = [row('t', 'table'), row('k', 'kitchen'), row('b', 'bag')];
    const orders = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const c = kitchenSwapGame.build(rows, buildCtx(rows, { rng: seeded(seed) }));
      if (c.game === 'kitchen_swap') orders.add(c.swaps[0]!.options.map((o) => o.product.slug).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('kitchenSwapGame.parseAnswers / grade', () => {
  const rows = [row('t', 'table'), row('k', 'kitchen'), row('b', 'bag')];
  const ctx = buildCtx(rows);

  it('nhận slug của đúng món hoặc null (hết giờ), đúng số món', () => {
    expect(kitchenSwapGame.parseAnswers(['t-dung', null, 'b-sai-a'], rows, ctx)).toEqual(['t-dung', null, 'b-sai-a']);
    expect(kitchenSwapGame.parseAnswers([null, null, null], rows, ctx)).toEqual([null, null, null]);
  });

  it.each([
    ['thiếu phần tử', ['t-dung', 'k-dung']],
    ['thừa phần tử', ['t-dung', 'k-dung', 'b-dung', null]],
    ['slug của món khác', ['k-dung', 'k-dung', 'b-dung']],
    ['slug lạ', ['t-dung', 'khong-co', 'b-dung']],
    ['không phải chữ', ['t-dung', 1, 'b-dung']],
    ['undefined', ['t-dung', undefined, 'b-dung']],
  ])('từ chối: %s', (_label, raw) => {
    expect(kitchenSwapGame.parseAnswers(raw as unknown[], rows, ctx)).toBeNull();
  });

  it('chấm từng món, trả đáp án, lời giải thích và nguồn', () => {
    const g = kitchenSwapGame.grade(rows, ['t-dung', 'k-sai-b', null], ctx);
    expect(g.correct).toBe(1);
    expect(g.total).toBe(3);
    expect(g.correctIds).toEqual(['t']);
    expect(g.review).toEqual({
      game: 'kitchen_swap',
      items: [
        { contentId: 't', correct: true, corner: 'table', item: 'Chai nước rửa chén 500 ml', given: 't-dung', expected: 't-dung', explanation: 'Giải thích t', sourceUrl: 'https://nguon.example.vn/t' },
        { contentId: 'k', correct: false, corner: 'kitchen', item: 'Chai nước rửa chén 500 ml', given: 'k-sai-b', expected: 'k-dung', explanation: 'Giải thích k', sourceUrl: 'https://nguon.example.vn/k' },
        { contentId: 'b', correct: false, corner: 'bag', item: 'Chai nước rửa chén 500 ml', given: null, expected: 'b-dung', explanation: 'Giải thích b', sourceUrl: 'https://nguon.example.vn/b' },
      ],
    });
  });

  it('đúng cả 3 thì cả 3 mục vào correctIds', () => {
    expect(kitchenSwapGame.grade(rows, ['t-dung', 'k-dung', 'b-dung'], ctx).correctIds).toEqual(['t', 'k', 'b']);
  });
});
