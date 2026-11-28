import { MINI_GAME_RULES } from '@tubutree/shared-types';
import { matchCardId } from '../game-mini-crypto';
import type { MiniBuildCtx, MiniContentRow, MiniPickCtx } from './game-def';
import { matchGame } from './match';

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

const PAIRS = MINI_GAME_RULES.match.items;
const SECRET = 'secret-spec-match';
const ROUND = 'round-spec-1';

const row = (i: number, over: Partial<MiniContentRow> = {}): MiniContentRow => ({
  id: `match-${String(i).padStart(2, '0')}`,
  game: 'match',
  payload: { ingredient: `Nguyên liệu ${i}`, use: `Công dụng ${i}` },
  explanation: `Giải thích cặp ${i}`,
  sourceUrl: `https://nguon.example.vn/match/${i}`,
  productSlug: null,
  ...over,
});
const pool = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));
const withPayload = (i: number, ingredient: string, use: string) => row(i, { payload: { ingredient, use } });

const pickCtx = (rng: () => number = seeded(5)): MiniPickCtx => ({ rng, dayKey: '2026-11-17', products: new Map() });
const buildCtx = (over: Partial<MiniBuildCtx> = {}): MiniBuildCtx => ({
  ...pickCtx(),
  sortHazardous: false,
  arcadeSeed: 0,
  cardId: (id, side) => matchCardId(SECRET, ROUND, id, side),
  ...over,
});
const cardOf = (r: MiniContentRow, side: 'ingredient' | 'use') => matchCardId(SECRET, ROUND, r.id, side);

describe('matchGame.payloadError', () => {
  it.each([
    ['đủ hai vế', { ingredient: 'Baking soda', use: 'Khử mùi tủ lạnh' }],
    ['vế dài đúng giới hạn (60 và 80)', { ingredient: 'a'.repeat(60), use: 'b'.repeat(80) }],
    ['có khoảng trắng hai đầu (được cắt)', { ingredient: '  Chanh  ', use: '  Tẩy cặn  ' }],
  ])('hợp lệ: %s', (_n, payload) => {
    expect(matchGame.payloadError(payload)).toBeNull();
  });

  it.each([
    ['không phải đối tượng', 'baking soda'],
    ['là mảng', [['a', 'b']]],
    ['null', null],
    ['thiếu nguyên liệu', { use: 'Khử mùi' }],
    ['thiếu công dụng', { ingredient: 'Chanh' }],
    ['nguyên liệu rỗng', { ingredient: '  ', use: 'Khử mùi' }],
    ['công dụng rỗng', { ingredient: 'Chanh', use: '' }],
    ['nguyên liệu dài 61 ký tự', { ingredient: 'a'.repeat(61), use: 'x' }],
    ['công dụng dài 81 ký tự', { ingredient: 'x', use: 'b'.repeat(81) }],
    ['nguyên liệu không phải chữ', { ingredient: 5, use: 'x' }],
  ])('sai: %s', (_n, payload) => {
    expect(matchGame.payloadError(payload)).toEqual(expect.stringContaining('Ghép Cặp'));
  });

  it('productSlugs theo slug của dòng; usable theo payload', () => {
    expect(matchGame.productSlugs(row(1, { productSlug: 'san-pham-a' }))).toEqual(['san-pham-a']);
    expect(matchGame.productSlugs(row(1))).toEqual([]);
    expect(matchGame.usable(row(1), pickCtx())).toBe(true);
    expect(matchGame.usable(row(2, { payload: { ingredient: 'x' } }), pickCtx())).toBe(false);
  });
});

describe('matchGame.pick', () => {
  it(`kho dưới ${PAIRS} cặp thì null`, () => {
    expect(matchGame.pick(pool(PAIRS - 1), pickCtx())).toBeNull();
    expect(matchGame.pick([], pickCtx())).toBeNull();
  });

  it(`chọn đúng ${PAIRS} cặp khác nhau, lặp lại được theo hạt giống`, () => {
    const a = matchGame.pick(pool(12), pickCtx(seeded(4)))!;
    const b = matchGame.pick(pool(12), pickCtx(seeded(4)))!;
    expect(a).toHaveLength(PAIRS);
    expect(new Set(a.map((r) => r.id)).size).toBe(PAIRS);
    expect(b.map((r) => r.id)).toEqual(a.map((r) => r.id));
  });

  it('bỏ cặp payload hỏng', () => {
    const broken = [row(90, { payload: { ingredient: 'x' } }), row(91, { payload: null })];
    expect(matchGame.pick([...pool(PAIRS - 1), ...broken], pickCtx())).toBeNull();
    for (let seed = 1; seed <= 10; seed++) {
      const picked = matchGame.pick([...pool(PAIRS), ...broken], pickCtx(seeded(seed)))!;
      expect(picked.map((r) => r.id)).not.toContain('match-90');
      expect(picked.map((r) => r.id)).not.toContain('match-91');
    }
  });

  it('không có hai thẻ cùng nhãn nguyên liệu (bỏ qua hoa thường, khoảng trắng thừa và dạng NFC/NFD)', () => {
    const rows = [
      ...pool(PAIRS - 1),
      withPayload(50, 'Baking soda', 'Khử mùi tủ lạnh'),
      withPayload(51, 'BAKING   SODA', 'Làm sạch vết cháy'),
      withPayload(52, 'baking soda', 'Tẩy cặn ấm đun'),
      withPayload(53, 'Cà phê', 'Hút ẩm'),
      withPayload(54, 'Cà phê', 'Khử mùi giày'),
    ];
    for (let seed = 1; seed <= 25; seed++) {
      const picked = matchGame.pick(rows, pickCtx(seeded(seed)))!;
      expect(picked).toHaveLength(PAIRS);
      const norm = picked.map((r) => (r.payload as { ingredient: string }).ingredient.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim());
      expect(new Set(norm).size).toBe(PAIRS);
    }
  });

  it('không có hai thẻ cùng nhãn công dụng', () => {
    const rows = [
      ...pool(PAIRS - 1),
      withPayload(50, 'Chanh', 'Tẩy cặn'),
      withPayload(51, 'Giấm', 'tẩy   cặn'),
      withPayload(52, 'Muối', 'TẨY CẶN'),
    ];
    for (let seed = 1; seed <= 25; seed++) {
      const picked = matchGame.pick(rows, pickCtx(seeded(seed)))!;
      expect(picked).toHaveLength(PAIRS);
      const uses = picked.map((r) => (r.payload as { use: string }).use.toLowerCase().replace(/\s+/g, ' ').trim());
      expect(new Set(uses).size).toBe(PAIRS);
    }
  });

  it('đủ số dòng nhưng chỉ còn dưới 6 cặp không trùng nhãn thì null', () => {
    const rows = [
      ...pool(PAIRS - 2),
      withPayload(50, 'Chanh', 'Tẩy cặn A'),
      withPayload(51, 'chanh', 'Tẩy cặn B'),
      withPayload(52, 'CHANH', 'Tẩy cặn C'),
    ];
    expect(rows.length).toBeGreaterThanOrEqual(PAIRS);
    expect(matchGame.pick(rows, pickCtx())).toBeNull();
  });

  it('không sửa mảng kho đầu vào', () => {
    const rows = pool(10);
    const snapshot = rows.map((r) => r.id);
    matchGame.pick(rows, pickCtx());
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});

describe('matchGame.build', () => {
  const rows = pool(PAIRS);

  it(`phát ${PAIRS * 2} thẻ, mỗi cặp một thẻ nguyên liệu và một thẻ công dụng, mã thẻ khác nhau`, () => {
    const content = matchGame.build(rows, buildCtx());
    if (content.game !== 'match') throw new Error('sai game');
    expect(content.cards).toHaveLength(PAIRS * 2);
    expect(content.cards.filter((c) => c.side === 'ingredient')).toHaveLength(PAIRS);
    expect(content.cards.filter((c) => c.side === 'use')).toHaveLength(PAIRS);
    expect(new Set(content.cards.map((c) => c.cardId)).size).toBe(PAIRS * 2);
    expect(content.cards.filter((c) => c.side === 'ingredient').map((c) => c.label).sort()).toEqual(
      rows.map((r) => (r.payload as { ingredient: string }).ingredient).sort(),
    );
  });

  it('mỗi thẻ chỉ có cardId, label, side và mã thẻ không lộ id nội dung hay đáp án', () => {
    const content = matchGame.build(rows, buildCtx());
    if (content.game !== 'match') throw new Error('sai game');
    for (const c of content.cards) expect(Object.keys(c).sort()).toEqual(['cardId', 'label', 'side']);
    const json = JSON.stringify(content);
    expect(json).not.toContain('contentId');
    expect(json).not.toContain('explanation');
    expect(json).not.toContain('sourceUrl');
    for (const r of rows) {
      expect(json).not.toContain(r.id);
      expect(json).not.toContain(r.explanation);
    }
  });

  it('mã thẻ là mã của ván hiện tại (cardId của ctx), hai ván khác nhau cho mã khác nhau', () => {
    const a = matchGame.build(rows, buildCtx());
    const b = matchGame.build(rows, buildCtx({ cardId: (id, side) => matchCardId(SECRET, 'round-khac', id, side) }));
    if (a.game !== 'match' || b.game !== 'match') throw new Error('sai game');
    expect(a.cards.map((c) => c.cardId)).toContain(cardOf(rows[0]!, 'ingredient'));
    const idsA = new Set(a.cards.map((c) => c.cardId));
    expect(b.cards.some((c) => idsA.has(c.cardId))).toBe(false);
  });

  it('thứ tự thẻ do rng quyết định: cùng hạt giống cùng thứ tự, khác hạt giống khác thứ tự', () => {
    const order = (seed: number) => {
      const c = matchGame.build(rows, buildCtx({ rng: seeded(seed) }));
      if (c.game !== 'match') throw new Error('sai game');
      return c.cards.map((x) => x.cardId);
    };
    expect(order(1)).toEqual(order(1));
    expect(order(1)).not.toEqual(order(2));
  });

  it('payload hỏng làm dựng ném lỗi', () => {
    expect(() => matchGame.build([row(1, { payload: { ingredient: 'x' } })], buildCtx())).toThrow('payload Ghép Cặp hỏng');
  });
});

describe('matchGame.parseAnswers', () => {
  const rows = pool(PAIRS);
  const ctx = buildCtx();
  const pair = (i: number): [string, string] => [cardOf(rows[i]!, 'ingredient'), cardOf(rows[i]!, 'use')];

  it('không ghép cặp nào hoặc ghép một phần vẫn hợp lệ', () => {
    expect(matchGame.parseAnswers([], rows, ctx)).toEqual([]);
    expect(matchGame.parseAnswers([pair(0), pair(3)], rows, ctx)).toEqual([pair(0), pair(3)]);
  });

  it('ghép đủ 6 cặp (kể cả ghép nhầm giữa các cặp) vẫn hợp lệ, chỉ là chấm sai', () => {
    const all = rows.map((_, i) => pair(i));
    expect(matchGame.parseAnswers(all, rows, ctx)).toEqual(all);
    const crossed: [string, string][] = [[cardOf(rows[0]!, 'ingredient'), cardOf(rows[1]!, 'use')]];
    expect(matchGame.parseAnswers(crossed, rows, ctx)).toEqual(crossed);
  });

  it('trả null khi nhiều cặp hơn số cặp đã phát', () => {
    const tooMany = [...rows.map((_, i) => pair(i)), pair(0)];
    expect(matchGame.parseAnswers(tooMany, rows, ctx)).toBeNull();
  });

  it.each([
    ['phần tử không phải mảng', ['abc']],
    ['cặp có 1 thẻ', [[cardOf(row(1), 'ingredient')]]],
    ['cặp có 3 thẻ', [[cardOf(row(1), 'ingredient'), cardOf(row(1), 'use'), cardOf(row(2), 'use')]]],
    ['thẻ không phải chuỗi', [[1, 2]]],
    ['thẻ là null', [[null, cardOf(row(1), 'use')]]],
    ['thẻ lạ', [['khong-co-the-nay', cardOf(row(1), 'use')]]],
    ['một thẻ ghép với chính nó', [[cardOf(row(1), 'ingredient'), cardOf(row(1), 'ingredient')]]],
    ['thẻ dùng lại ở cặp khác', [pair(0), [cardOf(rows[0]!, 'ingredient'), cardOf(rows[2]!, 'use')]]],
    ['thẻ của ván khác', [[matchCardId(SECRET, 'round-khac', 'match-01', 'ingredient'), cardOf(rows[0]!, 'use')]]],
    ['thẻ suy từ id cặp không có trong ván', [[cardOf(row(77), 'ingredient'), cardOf(row(77), 'use')]]],
  ])('trả null khi %s', (_n, raw) => {
    expect(matchGame.parseAnswers(raw as unknown[], rows, ctx)).toBeNull();
  });
});

describe('matchGame.grade', () => {
  const rows = pool(PAIRS);
  const ctx = buildCtx();
  const right = (i: number): [string, string] => [cardOf(rows[i]!, 'ingredient'), cardOf(rows[i]!, 'use')];

  it('ghép đúng cả 6 cặp', () => {
    const g = matchGame.grade(rows, rows.map((_, i) => right(i)), ctx);
    expect(g.correct).toBe(PAIRS);
    expect(g.total).toBe(PAIRS);
    expect(g.correctIds).toEqual(rows.map((r) => r.id));
  });

  it('thứ tự hai thẻ trong cặp không quan trọng', () => {
    const g = matchGame.grade(rows, [[cardOf(rows[2]!, 'use'), cardOf(rows[2]!, 'ingredient')]], ctx);
    expect(g.correct).toBe(1);
    expect(g.correctIds).toEqual([rows[2]!.id]);
  });

  it('ghép nhầm giữa hai cặp thì không tính; cặp chưa ghép thì không tính', () => {
    const g = matchGame.grade(rows, [right(0), [cardOf(rows[1]!, 'ingredient'), cardOf(rows[2]!, 'use')]], ctx);
    expect(g.correct).toBe(1);
    expect(g.correctIds).toEqual([rows[0]!.id]);
  });

  it('hai thẻ cùng mặt (nguyên liệu với nguyên liệu) không tính là đúng', () => {
    const g = matchGame.grade(rows, [[cardOf(rows[0]!, 'ingredient'), cardOf(rows[1]!, 'ingredient')]], ctx);
    expect(g.correct).toBe(0);
  });

  it('không ghép gì thì 0 đúng, tổng vẫn là số cặp đã phát', () => {
    const g = matchGame.grade(rows, [], ctx);
    expect(g.correct).toBe(0);
    expect(g.total).toBe(PAIRS);
    expect(g.correctIds).toEqual([]);
  });

  it('correctIds giữ thứ tự mục đã phát, không theo thứ tự khách ghép', () => {
    const g = matchGame.grade(rows, [right(4), right(1), right(3)], ctx);
    expect(g.correctIds).toEqual([rows[1]!.id, rows[3]!.id, rows[4]!.id]);
  });

  it('review từng cặp có hai vế, đúng/sai, lời giải thích, nguồn và slug sản phẩm', () => {
    const withSlug = rows.map((r, i) => (i === 0 ? { ...r, productSlug: 'san-pham-a' } : r));
    const g = matchGame.grade(withSlug, [right(0)], ctx);
    if (g.review.game !== 'match') throw new Error('sai game');
    expect(g.review.items).toHaveLength(PAIRS);
    expect(g.review.items[0]).toEqual({
      contentId: 'match-01',
      ingredient: 'Nguyên liệu 1',
      use: 'Công dụng 1',
      correct: true,
      explanation: 'Giải thích cặp 1',
      sourceUrl: 'https://nguon.example.vn/match/1',
      productSlug: 'san-pham-a',
    });
    expect(g.review.items[1]).toMatchObject({ contentId: 'match-02', correct: false, productSlug: null });
    expect(g.review.items[1]!.explanation).toBe('Giải thích cặp 2');
  });
});
