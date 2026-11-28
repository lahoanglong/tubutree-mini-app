import { MINI_BASKET_PICK, type MiniProductCard } from '@tubutree/shared-types';
import { basketGame, basketUsable } from './basket';
import type { MiniBuildCtx, MiniContentRow, MiniPickCtx } from './game-def';

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

const CORRECT = ['sp-dung-1', 'sp-dung-2', 'sp-dung-3'];
const WRONG = ['sp-sai-1', 'sp-sai-2', 'sp-sai-3'];
const ALL = [...CORRECT, ...WRONG];

const basketPayload = (over: Record<string, unknown> = {}) => ({
  task: 'Rửa bình sữa',
  correct: [...CORRECT],
  wrong: WRONG.map((slug, i) => ({ slug, reason: `Lý do sản phẩm sai ${i + 1}` })),
  ...over,
});
const row = (over: Partial<MiniContentRow> = {}): MiniContentRow => ({
  id: 'basket-01',
  game: 'basket',
  payload: basketPayload(),
  explanation: 'Giải thích đề giỏ',
  sourceUrl: 'https://nguon.example.vn/basket/1',
  productSlug: null,
  ...over,
});
const card = (slug: string, inStock = true): MiniProductCard => ({ slug, name: `Sản phẩm ${slug}`, imageUrl: null, price: 59_000, inStock });
const productMap = (slugs: string[] = ALL, outOfStock: string[] = []) =>
  new Map(slugs.map((s) => [s, card(s, !outOfStock.includes(s))] as const));

const pickCtx = (over: Partial<MiniPickCtx> = {}): MiniPickCtx => ({ rng: seeded(2), dayKey: '2026-11-17', products: productMap(), ...over });
const buildCtx = (over: Partial<MiniBuildCtx> = {}): MiniBuildCtx => ({
  ...pickCtx(),
  sortHazardous: false,
  arcadeSeed: 0,
  cardId: (id, side) => `${side}:${id}`,
  ...over,
});

describe('basketGame.payloadError', () => {
  it('hợp lệ: một đề, 3 slug đúng, 3 slug sai kèm lý do, 6 slug khác nhau', () => {
    expect(basketGame.payloadError(basketPayload())).toBeNull();
  });

  it('đề dài đúng 160 ký tự và lý do dài đúng 160 ký tự vẫn hợp lệ', () => {
    const payload = basketPayload({ task: 'a'.repeat(160), wrong: WRONG.map((slug) => ({ slug, reason: 'b'.repeat(160) })) });
    expect(basketGame.payloadError(payload)).toBeNull();
  });

  it.each([
    ['không phải đối tượng', 'rửa bình sữa'],
    ['null', null],
    ['là mảng', [basketPayload()]],
    ['thiếu đề', basketPayload({ task: undefined })],
    ['đề rỗng', basketPayload({ task: '   ' })],
    ['đề dài 161 ký tự', basketPayload({ task: 'a'.repeat(161) })],
    ['thiếu danh sách đúng', basketPayload({ correct: undefined })],
    ['thiếu danh sách sai', basketPayload({ wrong: undefined })],
    ['danh sách đúng không phải mảng', basketPayload({ correct: 'sp-dung-1' })],
    ['chỉ 2 slug đúng', basketPayload({ correct: CORRECT.slice(0, 2) })],
    ['4 slug đúng', basketPayload({ correct: [...CORRECT, 'sp-dung-4'] })],
    ['chỉ 2 mục sai', basketPayload({ wrong: [{ slug: 'sp-sai-1', reason: 'a' }, { slug: 'sp-sai-2', reason: 'b' }] })],
    ['slug đúng viết hoa', basketPayload({ correct: ['Sp-Dung-1', 'sp-dung-2', 'sp-dung-3'] })],
    ['slug đúng có khoảng trắng', basketPayload({ correct: ['sp dung 1', 'sp-dung-2', 'sp-dung-3'] })],
    ['slug đúng không phải chuỗi', basketPayload({ correct: [1, 'sp-dung-2', 'sp-dung-3'] })],
    ['slug sai có dấu gạch ngang cuối', basketPayload({ wrong: [{ slug: 'sp-sai-', reason: 'a' }, ...WRONG.slice(1).map((slug) => ({ slug, reason: 'x' }))] })],
    ['mục sai không phải đối tượng', basketPayload({ wrong: ['sp-sai-1', 'sp-sai-2', 'sp-sai-3'] })],
    ['mục sai thiếu lý do', basketPayload({ wrong: WRONG.map((slug) => ({ slug })) })],
    ['mục sai có lý do rỗng', basketPayload({ wrong: WRONG.map((slug) => ({ slug, reason: ' ' })) })],
    ['lý do dài 161 ký tự', basketPayload({ wrong: WRONG.map((slug) => ({ slug, reason: 'b'.repeat(161) })) })],
    ['slug trùng trong danh sách đúng', basketPayload({ correct: ['sp-dung-1', 'sp-dung-1', 'sp-dung-3'] })],
    ['slug trùng giữa đúng và sai', basketPayload({ wrong: [{ slug: 'sp-dung-1', reason: 'a' }, ...WRONG.slice(1).map((slug) => ({ slug, reason: 'x' }))] })],
    ['slug trùng trong danh sách sai', basketPayload({ wrong: ['sp-sai-1', 'sp-sai-1', 'sp-sai-3'].map((slug) => ({ slug, reason: 'x' })) })],
  ])('sai: %s', (_n, payload) => {
    expect(basketGame.payloadError(payload)).toEqual(expect.stringContaining('Giỏ Đúng Việc'));
  });
});

describe('basketGame.productSlugs / usable', () => {
  it('productSlugs trả đủ 6 slug của đề; payload hỏng thì rỗng', () => {
    expect(basketGame.productSlugs(row())).toEqual(ALL);
    expect(basketGame.productSlugs(row({ payload: { task: 'x' } }))).toEqual([]);
  });

  it('dùng được khi cả 6 sản phẩm còn bán và 3 sản phẩm đúng còn hàng', () => {
    expect(basketUsable(row(), { products: productMap() })).toBe(true);
    expect(basketGame.usable(row(), pickCtx())).toBe(true);
  });

  it('không dùng được khi thiếu một sản phẩm trong danh sách đang bán (đúng hoặc sai)', () => {
    expect(basketUsable(row(), { products: productMap(ALL.filter((s) => s !== 'sp-dung-2')) })).toBe(false);
    expect(basketUsable(row(), { products: productMap(ALL.filter((s) => s !== 'sp-sai-3')) })).toBe(false);
  });

  it('không dùng được khi bất kỳ sản phẩm nào (đúng hay sai) hết hàng: thẻ hết hàng sẽ lộ nó là đáp án sai', () => {
    expect(basketUsable(row(), { products: productMap(ALL, ['sp-dung-1']) })).toBe(false);
    expect(basketUsable(row(), { products: productMap(ALL, ['sp-sai-1']) })).toBe(false);
    expect(basketUsable(row(), { products: productMap(ALL) })).toBe(true);
  });

  it('payload hỏng thì không dùng được', () => {
    expect(basketUsable(row({ payload: { task: 'x' } }), { products: productMap() })).toBe(false);
  });
});

describe('basketGame.pick', () => {
  it('kho rỗng hoặc không đề nào dùng được thì null', () => {
    expect(basketGame.pick([], pickCtx())).toBeNull();
    expect(basketGame.pick([row()], pickCtx({ products: productMap(ALL, ['sp-dung-1']) }))).toBeNull();
    expect(basketGame.pick([row()], pickCtx({ products: new Map() }))).toBeNull();
  });

  it('chọn đúng một đề; bỏ qua đề hỏng hoặc thiếu hàng', () => {
    const good = row({ id: 'basket-good' });
    const broken = row({ id: 'basket-broken', payload: { task: 'x' } });
    const slugsOther = ['khac-1', 'khac-2', 'khac-3', 'khac-4', 'khac-5', 'khac-6'];
    const noStock = row({
      id: 'basket-hethang',
      payload: basketPayload({ correct: slugsOther.slice(0, 3), wrong: slugsOther.slice(3).map((slug) => ({ slug, reason: 'x' })) }),
    });
    const products = new Map([...productMap(), ...productMap(slugsOther, ['khac-1'])]);
    for (let seed = 1; seed <= 15; seed++) {
      const picked = basketGame.pick([broken, noStock, good], pickCtx({ rng: seeded(seed), products }))!;
      expect(picked).toHaveLength(1);
      expect(picked[0]!.id).toBe('basket-good');
    }
  });

  it('nhiều đề dùng được thì chọn ngẫu nhiên theo rng, lặp lại được theo hạt giống', () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ id: `basket-${i}` }));
    const a = basketGame.pick(rows, pickCtx({ rng: seeded(8) }))!;
    const b = basketGame.pick(rows, pickCtx({ rng: seeded(8) }))!;
    expect(b[0]!.id).toBe(a[0]!.id);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) seen.add(basketGame.pick(rows, pickCtx({ rng: seeded(seed) }))![0]!.id);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('basketGame.build', () => {
  it('trả đề và 6 thẻ sản phẩm, không có cờ đúng/sai, lý do, giải thích hay nguồn', () => {
    const content = basketGame.build([row()], buildCtx());
    if (content.game !== 'basket') throw new Error('sai game');
    expect(content.task.id).toBe('basket-01');
    expect(content.task.task).toBe('Rửa bình sữa');
    expect(content.task.products).toHaveLength(6);
    expect(content.task.products.map((p) => p.slug).sort()).toEqual([...ALL].sort());
    for (const p of content.task.products) expect(Object.keys(p).sort()).toEqual(['imageUrl', 'inStock', 'name', 'price', 'slug']);
    const json = JSON.stringify(content);
    expect(json).not.toContain('"correct"');
    expect(json).not.toContain('"wrong"');
    expect(json).not.toContain('"reason"');
    expect(json).not.toContain('explanation');
    expect(json).not.toContain('sourceUrl');
    expect(json).not.toContain('Lý do sản phẩm sai');
  });

  it('thứ tự sản phẩm do rng quyết định, không để 3 sản phẩm đúng đứng đầu cố định', () => {
    const order = (seed: number) => {
      const c = basketGame.build([row()], buildCtx({ rng: seeded(seed) }));
      if (c.game !== 'basket') throw new Error('sai game');
      return c.task.products.map((p) => p.slug);
    };
    expect(order(1)).toEqual(order(1));
    const firstThree = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) firstThree.add(order(seed).slice(0, 3).sort().join(','));
    expect(firstThree.size).toBeGreaterThan(1);
  });

  it('thẻ sản phẩm lấy từ products của ván; sản phẩm không có trong products thì bị bỏ', () => {
    const content = basketGame.build([row()], buildCtx({ products: productMap(ALL.filter((s) => s !== 'sp-sai-3')) }));
    if (content.game !== 'basket') throw new Error('sai game');
    expect(content.task.products).toHaveLength(5);
    expect(content.task.products.map((p) => p.slug)).not.toContain('sp-sai-3');
  });

  it('payload hỏng làm dựng ném lỗi', () => {
    expect(() => basketGame.build([row({ payload: { task: 'x' } })], buildCtx())).toThrow('payload Giỏ Đúng Việc hỏng');
  });
});

describe('basketGame.parseAnswers', () => {
  const rows = [row()];
  const ctx = buildCtx();

  it('không chọn gì, chọn một phần hoặc chọn đủ 3 slug trong 6 slug của đề đều hợp lệ', () => {
    expect(basketGame.parseAnswers([], rows, ctx)).toEqual([]);
    expect(basketGame.parseAnswers(['sp-dung-1'], rows, ctx)).toEqual(['sp-dung-1']);
    expect(basketGame.parseAnswers(['sp-dung-1', 'sp-sai-2', 'sp-sai-3'], rows, ctx)).toEqual(['sp-dung-1', 'sp-sai-2', 'sp-sai-3']);
  });

  it.each([
    ['quá 3 slug', ['sp-dung-1', 'sp-dung-2', 'sp-dung-3', 'sp-sai-1']],
    ['slug không thuộc đề', ['sp-dung-1', 'sp-la']],
    ['slug trùng nhau', ['sp-dung-1', 'sp-dung-1']],
    ['slug không phải chuỗi', ['sp-dung-1', 2]],
    ['phần tử null', [null]],
    ['phần tử undefined', [undefined]],
    ['slug viết khác hoa thường', ['SP-DUNG-1']],
    ['chuỗi rỗng', ['']],
  ])('trả null khi %s', (_n, raw) => {
    expect(basketGame.parseAnswers(raw as unknown[], rows, ctx)).toBeNull();
  });

  it('trả null khi số mục đã phát không phải đúng 1 đề', () => {
    expect(basketGame.parseAnswers([], [], ctx)).toBeNull();
    expect(basketGame.parseAnswers([], [row(), row({ id: 'basket-02' })], ctx)).toBeNull();
  });
});

describe('basketGame.grade', () => {
  const rows = [row()];
  const ctx = buildCtx();

  it('chọn đủ 3 sản phẩm đúng: 3/3, correctIds chứa id đề', () => {
    const g = basketGame.grade(rows, [...CORRECT], ctx);
    expect(g.correct).toBe(MINI_BASKET_PICK);
    expect(g.total).toBe(MINI_BASKET_PICK);
    expect(g.correctIds).toEqual(['basket-01']);
    if (g.review.game !== 'basket') throw new Error('sai game');
    expect(g.review.items[0]!.correct).toBe(true);
  });

  it('thứ tự chọn không quan trọng', () => {
    expect(basketGame.grade(rows, [CORRECT[2], CORRECT[0], CORRECT[1]], ctx).correct).toBe(3);
  });

  it('chọn 2 đúng 1 sai: đếm 2, correctIds rỗng (đề chỉ tính đúng khi đủ 3), review kèm lý do cho slug sai', () => {
    const g = basketGame.grade(rows, ['sp-dung-1', 'sp-dung-2', 'sp-sai-2'], ctx);
    expect(g.correct).toBe(2);
    expect(g.total).toBe(MINI_BASKET_PICK);
    expect(g.correctIds).toEqual([]);
    if (g.review.game !== 'basket') throw new Error('sai game');
    expect(g.review.items[0]!.correct).toBe(false);
    expect(g.review.items[0]!.picks).toEqual([
      { slug: 'sp-dung-1', correct: true, reason: null },
      { slug: 'sp-dung-2', correct: true, reason: null },
      { slug: 'sp-sai-2', correct: false, reason: 'Lý do sản phẩm sai 2' },
    ]);
  });

  it('không chọn gì: 0 đúng, tổng vẫn là 3, không có lựa chọn trong review', () => {
    const g = basketGame.grade(rows, [], ctx);
    expect(g.correct).toBe(0);
    expect(g.total).toBe(MINI_BASKET_PICK);
    expect(g.correctIds).toEqual([]);
    if (g.review.game !== 'basket') throw new Error('sai game');
    expect(g.review.items[0]!.picks).toEqual([]);
  });

  it('chọn toàn sản phẩm sai: 0 đúng', () => {
    const g = basketGame.grade(rows, [...WRONG], ctx);
    expect(g.correct).toBe(0);
    expect(g.correctIds).toEqual([]);
  });

  it('review nêu 3 slug đúng, lời giải thích và nguồn của đề', () => {
    const g = basketGame.grade(rows, ['sp-sai-1'], ctx);
    if (g.review.game !== 'basket') throw new Error('sai game');
    expect(g.review.items[0]).toMatchObject({
      contentId: 'basket-01',
      correctSlugs: CORRECT,
      explanation: 'Giải thích đề giỏ',
      sourceUrl: 'https://nguon.example.vn/basket/1',
    });
  });
});
