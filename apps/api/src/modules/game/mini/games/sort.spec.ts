import { MINI_GAME_RULES, type MiniSortBin } from '@tubutree/shared-types';
import type { MiniBuildCtx, MiniContentRow, MiniPickCtx } from './game-def';
import { sortGame } from './sort';

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

const BINS: MiniSortBin[] = ['recycle', 'food', 'other'];
const ITEMS = MINI_GAME_RULES.sort.items;

const row = (i: number, over: Partial<MiniContentRow> = {}): MiniContentRow => ({
  id: `sort-${String(i).padStart(2, '0')}`,
  game: 'sort',
  payload: { label: `Vật ${i}`, bin: BINS[i % 3], emoji: '♻️' },
  explanation: `Giải thích vật ${i}`,
  sourceUrl: `https://nguon.example.vn/sort/${i}`,
  productSlug: null,
  ...over,
});
const pool = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

const pickCtx = (rng: () => number = seeded(7)): MiniPickCtx => ({ rng, dayKey: '2026-11-17', products: new Map() });
const buildCtx = (extra: Partial<MiniBuildCtx> = {}): MiniBuildCtx => ({
  ...pickCtx(),
  sortHazardous: false,
  cardId: (id, side) => `${side}:${id}`,
  ...extra,
});

describe('sortGame.payloadError', () => {
  it.each([
    ['đủ nhãn, thùng và emoji', { label: 'Chai nhựa', bin: 'recycle', emoji: '🍼' }],
    ['không có emoji', { label: 'Vỏ chuối', bin: 'food' }],
    ['emoji null', { label: 'Vỏ chuối', bin: 'food', emoji: null }],
    ['thùng nguy hại', { label: 'Pin cũ', bin: 'hazardous' }],
    ['nhãn dài đúng 80 ký tự', { label: 'a'.repeat(80), bin: 'other' }],
    ['nhãn có khoảng trắng hai đầu (được cắt)', { label: '  Lon nhôm  ', bin: 'recycle' }],
  ])('hợp lệ: %s', (_name, payload) => {
    expect(sortGame.payloadError(payload)).toBeNull();
  });

  it.each([
    ['không phải đối tượng (chuỗi)', 'chai nhựa'],
    ['là mảng', [{ label: 'x', bin: 'food' }]],
    ['null', null],
    ['thiếu nhãn', { bin: 'food' }],
    ['nhãn rỗng sau khi cắt', { label: '   ', bin: 'food' }],
    ['nhãn dài 81 ký tự', { label: 'a'.repeat(81), bin: 'food' }],
    ['nhãn không phải chữ', { label: 5, bin: 'food' }],
    ['thiếu thùng', { label: 'Chai' }],
    ['thùng lạ', { label: 'Chai', bin: 'plastic' }],
    ['thùng sai hoa thường', { label: 'Chai', bin: 'Recycle' }],
    ['emoji rỗng', { label: 'Chai', bin: 'food', emoji: '' }],
    ['emoji dài 17 ký tự', { label: 'Chai', bin: 'food', emoji: 'a'.repeat(17) }],
    ['emoji không phải chữ', { label: 'Chai', bin: 'food', emoji: 3 }],
  ])('sai: %s', (_name, payload) => {
    const err = sortGame.payloadError(payload);
    expect(err).toEqual(expect.stringContaining('Đúng Thùng'));
  });

  it('usable theo đúng payloadError: payload hỏng thì không phát được', () => {
    expect(sortGame.usable(row(1), pickCtx())).toBe(true);
    expect(sortGame.usable(row(2, { payload: { label: 'x' } }), pickCtx())).toBe(false);
  });

  it('Đúng Thùng không gắn sản phẩm', () => {
    expect(sortGame.productSlugs(row(1, { productSlug: 'san-pham-a' }))).toEqual([]);
  });
});

describe('sortGame.pick', () => {
  it(`kho dưới ${ITEMS} mục dùng được thì null`, () => {
    expect(sortGame.pick(pool(ITEMS - 1), pickCtx())).toBeNull();
    expect(sortGame.pick([], pickCtx())).toBeNull();
  });

  it('mục payload hỏng không tính vào kho: 9 mục tốt + 3 mục hỏng vẫn thiếu', () => {
    const broken = [row(90, { payload: { label: 'x' } }), row(91, { payload: null }), row(92, { payload: { label: 'y', bin: 'zzz' } })];
    expect(sortGame.pick([...pool(ITEMS - 1), ...broken], pickCtx())).toBeNull();
  });

  it(`chọn đúng ${ITEMS} mục khác nhau và không bao giờ lấy mục hỏng`, () => {
    const broken = [row(90, { payload: { label: 'x' } }), row(91, { payload: null })];
    for (let seed = 1; seed <= 20; seed++) {
      const picked = sortGame.pick([...pool(14), ...broken], pickCtx(seeded(seed)))!;
      expect(picked).toHaveLength(ITEMS);
      expect(new Set(picked.map((r) => r.id)).size).toBe(ITEMS);
      expect(picked.some((r) => r.id === 'sort-90' || r.id === 'sort-91')).toBe(false);
    }
  });

  it('cùng hạt giống thì cùng bộ; khác hạt giống thì khác thứ tự hoặc khác bộ', () => {
    const a = sortGame.pick(pool(20), pickCtx(seeded(1)))!.map((r) => r.id);
    const again = sortGame.pick(pool(20), pickCtx(seeded(1)))!.map((r) => r.id);
    const other = sortGame.pick(pool(20), pickCtx(seeded(2)))!.map((r) => r.id);
    expect(again).toEqual(a);
    expect(other).not.toEqual(a);
  });

  it('không sửa mảng kho đầu vào', () => {
    const rows = pool(15);
    const snapshot = rows.map((r) => r.id);
    sortGame.pick(rows, pickCtx());
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});

describe('sortGame.build', () => {
  const rows = pool(ITEMS);

  it('trả bản không đáp án: mỗi vật chỉ có id, label, emoji', () => {
    const content = sortGame.build(rows, buildCtx());
    expect(content.game).toBe('sort');
    if (content.game !== 'sort') throw new Error('sai game');
    expect(content.items).toHaveLength(ITEMS);
    for (const item of content.items) expect(Object.keys(item).sort()).toEqual(['emoji', 'id', 'label']);
    const json = JSON.stringify(content);
    expect(json).not.toContain('"bin"');
    expect(json).not.toContain('explanation');
    expect(json).not.toContain('sourceUrl');
    for (const r of rows) {
      expect(json).not.toContain(r.explanation);
      expect(json).not.toContain(r.sourceUrl);
    }
  });

  it('giữ nguyên thứ tự mục đã chọn và emoji null khi payload không có', () => {
    const content = sortGame.build([row(1, { payload: { label: 'Lon', bin: 'recycle' } }), row(2)], buildCtx());
    if (content.game !== 'sort') throw new Error('sai game');
    expect(content.items.map((i) => i.id)).toEqual(['sort-01', 'sort-02']);
    expect(content.items[0]!.emoji).toBeNull();
    expect(content.items[1]!.emoji).toBe('♻️');
  });

  it('3 thùng chuẩn; kho có vật nguy hại thì thêm thùng thứ tư', () => {
    const std = sortGame.build(rows, buildCtx());
    const haz = sortGame.build(rows, buildCtx({ sortHazardous: true }));
    if (std.game !== 'sort' || haz.game !== 'sort') throw new Error('sai game');
    expect(std.bins).toEqual(['recycle', 'food', 'other']);
    expect(haz.bins).toEqual(['recycle', 'food', 'other', 'hazardous']);
  });

  it('mảng thùng là bản sao, không dùng chung giữa các lần dựng', () => {
    const a = sortGame.build(rows, buildCtx());
    const b = sortGame.build(rows, buildCtx());
    if (a.game !== 'sort' || b.game !== 'sort') throw new Error('sai game');
    a.bins.push('hazardous');
    expect(b.bins).toEqual(['recycle', 'food', 'other']);
  });

  it('payload hỏng làm dựng ném lỗi (nơi gọi đã lọc bằng pick)', () => {
    expect(() => sortGame.build([row(1, { payload: { label: 'x' } })], buildCtx())).toThrow('payload Đúng Thùng hỏng');
  });
});

describe('sortGame.parseAnswers', () => {
  const rows = pool(3);
  const ctx = buildCtx();

  it('đúng độ dài, mỗi phần tử là thùng hợp lệ hoặc null thì trả nguyên mảng', () => {
    const raw = ['recycle', null, 'hazardous'];
    expect(sortGame.parseAnswers(raw, rows, ctx)).toEqual(raw);
  });

  it.each([
    ['thiếu một phần tử', ['recycle', 'food']],
    ['dư một phần tử', ['recycle', 'food', 'other', 'food']],
    ['rỗng', []],
    ['thùng lạ', ['recycle', 'plastic', 'food']],
    ['sai hoa thường', ['Recycle', 'food', 'food']],
    ['số', [1, 2, 3]],
    ['đối tượng', [{ bin: 'food' }, 'food', 'food']],
    ['undefined (khác null)', [undefined, 'food', 'food']],
    ['chuỗi rỗng', ['', 'food', 'food']],
  ])('trả null khi %s', (_name, raw) => {
    expect(sortGame.parseAnswers(raw as unknown[], rows, ctx)).toBeNull();
  });
});

describe('sortGame.grade', () => {
  const rows = pool(ITEMS);
  const ctx = buildCtx();
  const expected = rows.map((r) => (r.payload as { bin: MiniSortBin }).bin);

  it('tất cả đúng', () => {
    const g = sortGame.grade(rows, expected, ctx);
    expect(g.correct).toBe(ITEMS);
    expect(g.total).toBe(ITEMS);
    expect(g.correctIds).toEqual(rows.map((r) => r.id));
  });

  it('đếm đúng số câu đúng; null và chọn sai đều tính sai; correctIds đúng các mục làm đúng', () => {
    const given: (MiniSortBin | null)[] = [...expected];
    given[0] = null;
    given[3] = expected[3] === 'food' ? 'other' : 'food';
    given[9] = expected[9] === 'recycle' ? 'other' : 'recycle';
    const g = sortGame.grade(rows, given, ctx);
    expect(g.correct).toBe(ITEMS - 3);
    expect(g.correctIds).toEqual(rows.filter((_, i) => ![0, 3, 9].includes(i)).map((r) => r.id));
    expect(g.review.game).toBe('sort');
  });

  it('bỏ trống hết thì 0 đúng, correctIds rỗng', () => {
    const g = sortGame.grade(rows, Array(ITEMS).fill(null), ctx);
    expect(g.correct).toBe(0);
    expect(g.correctIds).toEqual([]);
    expect(g.total).toBe(ITEMS);
  });

  it('review từng mục có nhãn, đáp án khách chọn, đáp án đúng, lời giải thích và nguồn', () => {
    const given: (MiniSortBin | null)[] = [...expected];
    given[1] = null;
    const g = sortGame.grade(rows, given, ctx);
    if (g.review.game !== 'sort') throw new Error('sai game');
    expect(g.review.items).toHaveLength(ITEMS);
    expect(g.review.items[0]).toEqual({
      contentId: 'sort-01',
      label: 'Vật 1',
      given: expected[0],
      expected: expected[0],
      correct: true,
      explanation: 'Giải thích vật 1',
      sourceUrl: 'https://nguon.example.vn/sort/1',
    });
    expect(g.review.items[1]).toMatchObject({ contentId: 'sort-02', given: null, expected: expected[1], correct: false });
  });

  it('mục lời giải thích và nguồn lấy từ chính dòng nội dung, không lẫn giữa các mục', () => {
    const g = sortGame.grade(rows, expected, ctx);
    if (g.review.game !== 'sort') throw new Error('sai game');
    g.review.items.forEach((it, i) => {
      expect(it.explanation).toBe(rows[i]!.explanation);
      expect(it.sourceUrl).toBe(rows[i]!.sourceUrl);
    });
  });
});
