import { MINI_GAME_RULES, type MiniGameId, type MiniProductCard } from '@tubutree/shared-types';
import { dailyQuizGame, originGame, pickDailyQuiz, pickOrigin, readChoicePayload } from './choice';
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

const DAY = '2026-11-17';
const QUIZ = MINI_GAME_RULES.daily_quiz.items;
const ORIGIN = MINI_GAME_RULES.origin.items;

const pad = (i: number) => String(i).padStart(2, '0');
const choiceRow = (game: MiniGameId, i: number, over: Partial<MiniContentRow> = {}): MiniContentRow => ({
  id: `${game}-${pad(i)}`,
  game,
  payload: { prompt: `Câu hỏi ${i}?`, options: ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D'], answer: i % 4 },
  explanation: `Giải thích câu ${i}`,
  sourceUrl: `https://nguon.example.vn/${game}/${i}`,
  productSlug: null,
  ...over,
});
const card = (slug: string): MiniProductCard => ({ slug, name: `Sản phẩm ${slug}`, imageUrl: null, price: 69_000, inStock: true });

/** Kho Đố Xanh: `size` câu, các chỉ số trong `linked` gắn sản phẩm. */
const quizPool = (size: number, linked: number[] = []) =>
  Array.from({ length: size }, (_, i) => choiceRow('daily_quiz', i + 1, linked.includes(i + 1) ? { productSlug: `sp-${i + 1}` } : {}));

const pickCtx = (over: Partial<MiniPickCtx> = {}): MiniPickCtx => ({ rng: seeded(3), dayKey: DAY, products: new Map(), ...over });
const buildCtx = (over: Partial<MiniBuildCtx> = {}): MiniBuildCtx => ({
  ...pickCtx(),
  sortHazardous: false,
  cardId: (id, side) => `${side}:${id}`,
  ...over,
});

const permutations = (rows: MiniContentRow[]): MiniContentRow[][] => {
  const rng = seeded(11);
  const shuffledCopy = () => {
    const out = [...rows];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return [rows, [...rows].reverse(), shuffledCopy(), shuffledCopy(), [...rows.slice(7), ...rows.slice(0, 7)]];
};

describe.each([
  ['daily_quiz', dailyQuizGame, 'Đố Xanh'],
  ['origin', originGame, 'Đoán Xuất Xứ'],
] as const)('%s: payloadError', (game, def, name) => {
  it.each([
    ['2 lựa chọn', { prompt: 'Câu?', options: ['Có', 'Không'], answer: 0 }],
    ['4 lựa chọn, đáp án cuối', { prompt: 'Câu?', options: ['a', 'b', 'c', 'd'], answer: 3 }],
    ['lời hỏi dài đúng 300 ký tự', { prompt: 'a'.repeat(300), options: ['Có', 'Không'], answer: 1 }],
    ['lựa chọn dài đúng 120 ký tự', { prompt: 'Câu?', options: ['a'.repeat(120), 'b'], answer: 0 }],
  ])('hợp lệ: %s', (_n, payload) => {
    expect(def.payloadError(payload)).toBeNull();
  });

  it.each([
    ['không phải đối tượng', 'câu hỏi'],
    ['null', null],
    ['thiếu lời hỏi', { options: ['a', 'b'], answer: 0 }],
    ['lời hỏi rỗng', { prompt: '  ', options: ['a', 'b'], answer: 0 }],
    ['lời hỏi dài 301 ký tự', { prompt: 'a'.repeat(301), options: ['a', 'b'], answer: 0 }],
    ['thiếu lựa chọn', { prompt: 'Câu?', answer: 0 }],
    ['lựa chọn không phải mảng', { prompt: 'Câu?', options: 'a,b', answer: 0 }],
    ['chỉ 1 lựa chọn', { prompt: 'Câu?', options: ['a'], answer: 0 }],
    ['5 lựa chọn', { prompt: 'Câu?', options: ['a', 'b', 'c', 'd', 'e'], answer: 0 }],
    ['lựa chọn rỗng', { prompt: 'Câu?', options: ['a', ''], answer: 0 }],
    ['lựa chọn không phải chữ', { prompt: 'Câu?', options: ['a', 2], answer: 0 }],
    ['lựa chọn dài 121 ký tự', { prompt: 'Câu?', options: ['a'.repeat(121), 'b'], answer: 0 }],
    ['hai lựa chọn trùng nhau', { prompt: 'Câu?', options: ['Hà Nội', 'Hà Nội'], answer: 0 }],
    ['hai lựa chọn chỉ khác hoa thường', { prompt: 'Câu?', options: ['Hà Nội', 'hà nội'], answer: 0 }],
    ['thiếu đáp án', { prompt: 'Câu?', options: ['a', 'b'] }],
    ['đáp án là chuỗi', { prompt: 'Câu?', options: ['a', 'b'], answer: '1' }],
    ['đáp án không nguyên', { prompt: 'Câu?', options: ['a', 'b'], answer: 0.5 }],
    ['đáp án âm', { prompt: 'Câu?', options: ['a', 'b'], answer: -1 }],
    ['đáp án ngoài số lựa chọn', { prompt: 'Câu?', options: ['a', 'b'], answer: 2 }],
    ['đáp án NaN', { prompt: 'Câu?', options: ['a', 'b'], answer: Number.NaN }],
  ])(`sai: %s (câu lỗi nêu tên game ${name})`, (_n, payload) => {
    expect(def.payloadError(payload)).toEqual(expect.stringContaining(name));
  });

  it('readChoicePayload cắt khoảng trắng và trả đúng hình dạng', () => {
    expect(readChoicePayload({ prompt: '  Câu?  ', options: [' a ', 'b'], answer: 1 })).toEqual({ prompt: 'Câu?', options: ['a', 'b'], answer: 1 });
  });

  it('productSlugs: có slug thì một phần tử, không có thì rỗng', () => {
    expect(def.productSlugs(choiceRow(game, 1, { productSlug: 'san-pham-a' }))).toEqual(['san-pham-a']);
    expect(def.productSlugs(choiceRow(game, 1))).toEqual([]);
  });

  it('usable theo payload: payload hỏng thì không phát được', () => {
    expect(def.usable(choiceRow(game, 1), pickCtx())).toBe(true);
    expect(def.usable(choiceRow(game, 2, { payload: { prompt: 'x' } }), pickCtx())).toBe(false);
  });
});

describe('Đố Xanh (daily_quiz): pick', () => {
  const pool = quizPool(30, [5, 17, 28]);

  it(`kho dưới ${QUIZ} câu dùng được thì null`, () => {
    expect(dailyQuizGame.pick(quizPool(QUIZ - 1), pickCtx())).toBeNull();
    expect(dailyQuizGame.pick([], pickCtx())).toBeNull();
  });

  it('câu payload hỏng không tính vào kho', () => {
    const broken = [choiceRow('daily_quiz', 90, { payload: { prompt: 'x' } }), choiceRow('daily_quiz', 91, { payload: null })];
    expect(dailyQuizGame.pick([...quizPool(QUIZ - 1), ...broken], pickCtx())).toBeNull();
    const picked = dailyQuizGame.pick([...quizPool(QUIZ), ...broken], pickCtx())!;
    expect(picked.map((r) => r.id)).not.toContain('daily_quiz-90');
    expect(picked.map((r) => r.id)).not.toContain('daily_quiz-91');
  });

  it(`cùng dayKey thì cùng ${QUIZ} id dù kho sắp theo thứ tự nào`, () => {
    const expected = dailyQuizGame.pick(pool, pickCtx())!.map((r) => r.id);
    expect(expected).toHaveLength(QUIZ);
    for (const perm of permutations(pool)) {
      expect(dailyQuizGame.pick(perm, pickCtx({ rng: seeded(99) }))!.map((r) => r.id)).toEqual(expected);
    }
  });

  it('không phụ thuộc rng: rng ném lỗi vẫn chọn được (mọi người cùng một bộ)', () => {
    const boom = () => {
      throw new Error('không được gọi rng');
    };
    expect(() => dailyQuizGame.pick(pool, pickCtx({ rng: boom }))).not.toThrow();
  });

  it('câu thứ 3 là câu gắn sản phẩm khi kho có, kể cả khi sản phẩm không còn bán (products rỗng)', () => {
    const picked = dailyQuizGame.pick(pool, pickCtx({ products: new Map() }))!;
    expect(picked[2]!.productSlug).toBeTruthy();
    expect(picked[0]!.id).not.toBe(picked[2]!.id);
    expect(picked[1]!.id).not.toBe(picked[2]!.id);
    expect(new Set(picked.map((r) => r.id)).size).toBe(QUIZ);
  });

  it('câu gắn sản phẩm xoay vòng theo ngày: 3 ngày liền thấy đủ 3 câu gắn khác nhau', () => {
    const thirds = ['2026-11-17', '2026-11-18', '2026-11-19'].map((d) => dailyQuizGame.pick(pool, pickCtx({ dayKey: d }))![2]!.id);
    expect(new Set(thirds).size).toBe(3);
    for (const id of thirds) expect(['daily_quiz-05', 'daily_quiz-17', 'daily_quiz-28']).toContain(id);
  });

  it('khác ngày thì bộ khác khi kho đủ lớn', () => {
    const days = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
    const sets = days.map((d) => dailyQuizGame.pick(pool, pickCtx({ dayKey: d }))!.map((r) => r.id).join(','));
    expect(new Set(sets).size).toBe(days.length);
  });

  it('kho không có câu gắn sản phẩm: xoay vòng theo thứ tự id, ba câu liên tiếp', () => {
    const plain = quizPool(30);
    const picked = dailyQuizGame.pick(plain, pickCtx())!;
    expect(picked).toHaveLength(QUIZ);
    expect(picked.every((r) => !r.productSlug)).toBe(true);
    const ids = plain.map((r) => r.id);
    const start = ids.indexOf(picked[0]!.id);
    expect(picked.map((r) => r.id)).toEqual([0, 1, 2].map((k) => ids[(start + k) % ids.length]));
  });

  it('kho vừa đủ 3 câu, một câu gắn sản phẩm: vẫn ra đủ 3 câu khác nhau, câu gắn ở cuối', () => {
    const picked = dailyQuizGame.pick(quizPool(QUIZ, [1]), pickCtx())!;
    expect(picked).toHaveLength(QUIZ);
    expect(new Set(picked.map((r) => r.id)).size).toBe(QUIZ);
    expect(picked[2]!.productSlug).toBe('sp-1');
  });

  it('pickDailyQuiz xuất ra dùng được trực tiếp và khớp game.pick', () => {
    expect(pickDailyQuiz(pool, { dayKey: DAY })!.map((r) => r.id)).toEqual(dailyQuizGame.pick(pool, pickCtx())!.map((r) => r.id));
  });

  it('không sửa mảng kho đầu vào', () => {
    const rows = [...pool].reverse();
    const snapshot = rows.map((r) => r.id);
    dailyQuizGame.pick(rows, pickCtx());
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});

describe('Đoán Xuất Xứ (origin): pick', () => {
  const originPool = (size: number, linked: number[] = []) =>
    Array.from({ length: size }, (_, i) => choiceRow('origin', i + 1, linked.includes(i + 1) ? { productSlug: `sp-${i + 1}` } : {}));

  it(`kho dưới ${ORIGIN} mục dùng được thì null`, () => {
    expect(originGame.pick(originPool(ORIGIN - 1), pickCtx())).toBeNull();
    const broken = [choiceRow('origin', 90, { payload: { prompt: 'x' } })];
    expect(originGame.pick([...originPool(ORIGIN - 1), ...broken], pickCtx())).toBeNull();
  });

  it(`chọn ${ORIGIN} mục khác nhau, lặp lại được theo hạt giống`, () => {
    const a = originGame.pick(originPool(15), pickCtx({ rng: seeded(5) }))!;
    const b = originGame.pick(originPool(15), pickCtx({ rng: seeded(5) }))!;
    expect(a).toHaveLength(ORIGIN);
    expect(new Set(a.map((r) => r.id)).size).toBe(ORIGIN);
    expect(b.map((r) => r.id)).toEqual(a.map((r) => r.id));
  });

  it('lượt cuối là mục gắn sản phẩm đang bán khi có', () => {
    const rows = originPool(15, [4, 9]);
    const products = new Map([['sp-9', card('sp-9')]]);
    for (let seed = 1; seed <= 15; seed++) {
      const picked = originGame.pick(rows, pickCtx({ rng: seeded(seed), products }))!;
      expect(picked).toHaveLength(ORIGIN);
      expect(picked[ORIGIN - 1]!.id).toBe('origin-09');
      expect(new Set(picked.map((r) => r.id)).size).toBe(ORIGIN);
    }
  });

  it('mục gắn sản phẩm đã ngừng bán (không có trong products) thì không ép vào lượt cuối', () => {
    const rows = originPool(15, [4, 9]);
    const ids = new Set<string>();
    for (let seed = 1; seed <= 15; seed++) {
      const picked = originGame.pick(rows, pickCtx({ rng: seeded(seed), products: new Map() }))!;
      expect(picked).toHaveLength(ORIGIN);
      ids.add(picked[ORIGIN - 1]!.id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });

  it('pickOrigin xuất ra dùng được trực tiếp', () => {
    expect(pickOrigin(originPool(8), pickCtx())).toHaveLength(ORIGIN);
  });
});

describe.each([
  ['daily_quiz', dailyQuizGame, QUIZ],
  ['origin', originGame, ORIGIN],
] as const)('%s: build', (game, def, size) => {
  const rows = Array.from({ length: size }, (_, i) => choiceRow(game, i + 1, i === 0 ? { productSlug: 'sp-1' } : i === 1 ? { productSlug: 'sp-het-ban' } : {}));

  it('mỗi mục chỉ có id, prompt, options, product; không có đáp án, giải thích hay nguồn', () => {
    const content = def.build(rows, buildCtx({ products: new Map([['sp-1', card('sp-1')]]) }));
    expect(content.game).toBe(game);
    if (content.game !== 'daily_quiz' && content.game !== 'origin') throw new Error('sai game');
    expect(content.items).toHaveLength(size);
    for (const item of content.items) expect(Object.keys(item).sort()).toEqual(['id', 'options', 'product', 'prompt']);
    const json = JSON.stringify(content);
    expect(json).not.toContain('"answer"');
    expect(json).not.toContain('explanation');
    expect(json).not.toContain('sourceUrl');
    for (const r of rows) {
      expect(json).not.toContain(r.explanation);
      expect(json).not.toContain(r.sourceUrl);
    }
  });

  it('gắn thẻ sản phẩm khi sản phẩm còn bán; thiếu trong products hoặc không gắn thì product là null', () => {
    const content = def.build(rows, buildCtx({ products: new Map([['sp-1', card('sp-1')]]) }));
    if (content.game !== 'daily_quiz' && content.game !== 'origin') throw new Error('sai game');
    expect(content.items[0]!.product).toEqual(card('sp-1'));
    expect(content.items[1]!.product).toBeNull();
    if (size > 2) expect(content.items[2]!.product).toBeNull();
  });

  it('giữ nguyên thứ tự lựa chọn của payload (không xáo, vì chỉ số đáp án phụ thuộc thứ tự)', () => {
    const content = def.build(rows, buildCtx());
    if (content.game !== 'daily_quiz' && content.game !== 'origin') throw new Error('sai game');
    expect(content.items[0]!.options).toEqual(['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D']);
  });

  it('payload hỏng làm dựng ném lỗi', () => {
    expect(() => def.build([choiceRow(game, 1, { payload: { prompt: 'x' } })], buildCtx())).toThrow('payload trắc nghiệm hỏng');
  });
});

describe.each([
  ['daily_quiz', dailyQuizGame, QUIZ],
  ['origin', originGame, ORIGIN],
] as const)('%s: parseAnswers', (game, def, size) => {
  const rows = Array.from({ length: size }, (_, i) => choiceRow(game, i + 1));
  const ctx = buildCtx();
  const valid = Array.from({ length: size }, (_, i) => i % 4);

  it('đủ độ dài, chỉ số hợp lệ hoặc null thì trả nguyên mảng', () => {
    expect(def.parseAnswers(valid, rows, ctx)).toEqual(valid);
    expect(def.parseAnswers(Array(size).fill(null), rows, ctx)).toEqual(Array(size).fill(null));
  });

  it.each([
    ['thiếu một phần tử', (a: unknown[]) => a.slice(1)],
    ['dư một phần tử', (a: unknown[]) => [...a, 0]],
    ['chỉ số âm', (a: unknown[]) => [-1, ...a.slice(1)]],
    ['chỉ số bằng số lựa chọn', (a: unknown[]) => [4, ...a.slice(1)]],
    ['chỉ số không nguyên', (a: unknown[]) => [1.5, ...a.slice(1)]],
    ['chỉ số là chuỗi', (a: unknown[]) => ['1', ...a.slice(1)]],
    ['NaN', (a: unknown[]) => [Number.NaN, ...a.slice(1)]],
    ['undefined (khác null)', (a: unknown[]) => [undefined, ...a.slice(1)]],
    ['boolean', (a: unknown[]) => [true, ...a.slice(1)]],
  ])('trả null khi %s', (_n, mutate) => {
    expect(def.parseAnswers(mutate([...valid]), rows, ctx)).toBeNull();
  });

  it('giới hạn chỉ số theo số lựa chọn của TỪNG câu (câu 2 lựa chọn: chỉ số 2 sai dạng)', () => {
    const twoOptions = choiceRow(game, 1, { payload: { prompt: 'Có hay không?', options: ['Có', 'Không'], answer: 1 } });
    const mixed = [twoOptions, ...rows.slice(1)];
    expect(def.parseAnswers([1, ...valid.slice(1)], mixed, ctx)).not.toBeNull();
    expect(def.parseAnswers([2, ...valid.slice(1)], mixed, ctx)).toBeNull();
  });
});

describe.each([
  ['daily_quiz', dailyQuizGame, QUIZ],
  ['origin', originGame, ORIGIN],
] as const)('%s: grade', (game, def, size) => {
  const rows = Array.from({ length: size }, (_, i) => choiceRow(game, i + 1, i === 0 ? { productSlug: 'san-pham-a' } : {}));
  const ctx = buildCtx();
  const correctAnswers = rows.map((r) => (r.payload as { answer: number }).answer);
  const wrongOf = (n: number) => (n + 1) % 4;

  it('tất cả đúng', () => {
    const g = def.grade(rows, correctAnswers, ctx);
    expect(g.correct).toBe(size);
    expect(g.total).toBe(size);
    expect(g.correctIds).toEqual(rows.map((r) => r.id));
  });

  it('đếm đúng số câu đúng: câu bỏ trống (null) và câu chọn sai đều tính sai', () => {
    const given: (number | null)[] = [...correctAnswers];
    given[0] = null;
    given[1] = wrongOf(correctAnswers[1]!);
    const g = def.grade(rows, given, ctx);
    expect(g.correct).toBe(size - 2);
    expect(g.correctIds).toEqual(rows.slice(2).map((r) => r.id));
  });

  it('bỏ trống hết thì 0 đúng', () => {
    const g = def.grade(rows, Array(size).fill(null), ctx);
    expect(g.correct).toBe(0);
    expect(g.correctIds).toEqual([]);
  });

  it('review có lời hỏi, đáp án khách chọn, đáp án đúng, lời giải thích, nguồn và slug sản phẩm', () => {
    const given: (number | null)[] = [...correctAnswers];
    given[1] = null;
    const g = def.grade(rows, given, ctx);
    if (g.review.game !== game) throw new Error('sai game');
    expect(g.review.items[0]).toEqual({
      contentId: rows[0]!.id,
      prompt: 'Câu hỏi 1?',
      given: correctAnswers[0],
      expected: correctAnswers[0],
      correct: true,
      explanation: 'Giải thích câu 1',
      sourceUrl: `https://nguon.example.vn/${game}/1`,
      productSlug: 'san-pham-a',
    });
    expect(g.review.items[1]).toMatchObject({ contentId: rows[1]!.id, given: null, correct: false, productSlug: null });
    expect(g.review.items[1]!.explanation).toBe(rows[1]!.explanation);
    expect(g.review.items[1]!.sourceUrl).toBe(rows[1]!.sourceUrl);
  });
});
