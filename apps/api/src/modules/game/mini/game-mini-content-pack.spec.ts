import {
  MINI_BASKET_PICK,
  MINI_GAME_RULES,
  MINI_MIN_ACTIVE_ITEMS,
  MINI_SORT_BINS,
  type MiniGameId,
  type MiniProductCard,
} from '@tubutree/shared-types';
import {
  activeCounts,
  findBannedPhrases,
  loadGameMiniPack,
  parseGameMiniArgs,
  validateGameMiniPack,
  visibleTexts,
  type GameMiniItem,
  type GameMiniPack,
} from '../../../../prisma/seed-game-mini';
import { QUIZZES } from '../../../../prisma/seed-game-quiz';
import { MINI_GAMES, type MiniBuildCtx, type MiniContentRow } from './games';
import { readBasketPayload } from './games/basket';
import { readChoicePayload } from './games/choice';
import { readSortPayload } from './games/sort';
import { LEGACY_QUIZ_PREFIX } from './game-mini-content.service';
import { MINI_EXPLANATION_MAX } from './game-mini-admin.service';

/**
 * Gói nội dung thật của 5 game mini (`prisma/reference-data/game-mini/*.json`): luật nguồn, cụm cấm, đáp án, và mỗi game chơi trọn
 * được một ván bằng đúng các mục đang bật. Số mục bật ghi cứng để mọi lần thêm hay tắt mục là thay đổi có chủ ý.
 */
const GAMES: MiniGameId[] = ['sort', 'daily_quiz', 'match', 'origin', 'basket'];
const pack = loadGameMiniPack();
const clone = (): GameMiniPack => JSON.parse(JSON.stringify(pack)) as GameMiniPack;
const allItems = (): (GameMiniItem & { game: MiniGameId })[] => GAMES.flatMap((game) => pack.games[game].map((i) => ({ ...i, game })));

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const products = new Map<string, MiniProductCard>(
  pack.products.map((p) => [p.slug, { slug: p.slug, name: p.name, imageUrl: null, price: 50_000, inStock: p.inStock }]),
);

const legacyById = new Map(QUIZZES.map((q) => [q.id, q]));
const legacyRows = (): MiniContentRow[] =>
  pack.legacy.map((l) => {
    const q = legacyById.get(l.id)!;
    return {
      id: `${LEGACY_QUIZ_PREFIX}${q.id}`,
      game: 'daily_quiz',
      payload: { prompt: q.question, options: q.options, answer: q.correct },
      explanation: q.explanation ?? '',
      sourceUrl: l.sourceUrl,
      productSlug: null,
    };
  });

/** Kho như `GameMiniContentService.pool` dựng: mục đang bật, cộng câu cũ có nguồn cho Đố Xanh. */
const poolOf = (game: MiniGameId): MiniContentRow[] => {
  const rows = pack.games[game]
    .filter((i) => i.active)
    .map((i) => ({ id: i.id, game, payload: i.payload, explanation: i.explanation, sourceUrl: i.sourceUrl, productSlug: i.productSlug ?? null }));
  return game === 'daily_quiz' ? [...rows, ...legacyRows()] : rows;
};

const buildCtx = (rng: () => number, dayKey: string, sortHazardous: boolean): MiniBuildCtx => ({
  rng,
  dayKey,
  products,
  sortHazardous,
  cardId: (id, side) => `c-${side === 'ingredient' ? 'i' : 'u'}-${id}`,
});

/** Đáp án đúng máy chủ biết, theo dạng khách gửi lên. */
const correctAnswers = (game: MiniGameId, rows: MiniContentRow[], ctx: MiniBuildCtx): unknown[] => {
  switch (game) {
    case 'sort':
      return rows.map((r) => readSortPayload(r.payload)!.bin);
    case 'daily_quiz':
    case 'origin':
      return rows.map((r) => readChoicePayload(r.payload)!.answer);
    case 'match':
      return rows.map((r) => [ctx.cardId(r.id, 'use'), ctx.cardId(r.id, 'ingredient')]);
    case 'basket':
      return [...readBasketPayload(rows[0]!.payload)!.correct].reverse();
  }
};

const days = Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 10, 17) + i * 86_400_000).toISOString().slice(0, 10));

describe('gói nội dung game mini', () => {
  it('cả gói hợp lệ: nguồn https có trong sources.json, không cụm cấm, đáp án trong lựa chọn, id không trùng, slug có trong ảnh chụp', () => {
    expect(validateGameMiniPack(pack)).toEqual([]);
  });

  it('số mục bật mỗi game đúng như đã duyệt, game nào cũng đủ ngưỡng hiện', () => {
    const counts = activeCounts(pack);
    expect(counts).toEqual({
      sort: { total: 90, active: 84, belowMinimum: false },
      daily_quiz: { total: 51, active: 49, belowMinimum: false },
      match: { total: 23, active: 22, belowMinimum: false },
      origin: { total: 32, active: 32, belowMinimum: false },
      basket: { total: 13, active: 12, belowMinimum: false },
    });
    for (const game of GAMES) expect(counts[game].active).toBeGreaterThanOrEqual(MINI_MIN_ACTIVE_ITEMS);
    expect(pack.games.daily_quiz.filter((i) => i.active).length + pack.legacy.length).toBe(counts.daily_quiz.active);
  });

  it('id không trùng trên toàn gói và mỗi id mang tiền tố game của nó', () => {
    const ids = allItems().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prefix: Record<MiniGameId, string> = { sort: 'gm-sort-', daily_quiz: 'gm-quiz-', match: 'gm-match-', origin: 'gm-origin-', basket: 'gm-basket-' };
    expect(allItems().filter((i) => !i.id.startsWith(prefix[i.game])).map((i) => i.id)).toEqual([]);
  });

  it('mọi sourceUrl là https đầy đủ; câu khoa học không dẫn trang Tubu; đề Giỏ Đúng Việc dẫn nhãn sản phẩm', () => {
    for (const i of allItems()) {
      const u = new URL(i.sourceUrl);
      expect(`${i.id} ${u.protocol}`).toBe(`${i.id} https:`);
      expect(u.hostname).toContain('.');
      if (i.game === 'basket') expect(u.hostname).toBe('tubutree.com');
      else expect(u.hostname.endsWith('tubutree.com')).toBe(false);
    }
    for (const l of pack.legacy) expect(new URL(l.sourceUrl).protocol).toBe('https:');
  });

  it('mục tắt đều ghi lý do; mục bật không mang lý do tắt', () => {
    const inactive = allItems().filter((i) => !i.active);
    expect(inactive.map((i) => i.game).sort()).toEqual(['basket', 'daily_quiz', 'daily_quiz', 'match', 'sort', 'sort', 'sort', 'sort', 'sort', 'sort']);
    for (const i of inactive) expect(i.inactiveReason?.trim().length ?? 0).toBeGreaterThan(10);
    expect(allItems().filter((i) => i.active && i.inactiveReason).map((i) => i.id)).toEqual([]);
  });

  it.each(['daily_quiz', 'origin'] as const)('%s: vị trí đáp án đúng rải đều (lựa chọn phát đúng thứ tự lưu, không xáo)', (game) => {
    const active = pack.games[game].filter((i) => i.active).map((i) => readChoicePayload(i.payload)!);
    const byIndex = new Map<number, number>();
    for (const p of active) byIndex.set(p.answer, (byIndex.get(p.answer) ?? 0) + 1);
    expect([...byIndex.keys()].sort()).toEqual([0, 1, 2, 3]);
    for (const n of byIndex.values()) expect(n / active.length).toBeLessThanOrEqual(0.4);
  });

  it('đáp án nằm trong tập lựa chọn của từng game', () => {
    for (const i of pack.games.sort) expect(MINI_SORT_BINS).toContain(readSortPayload(i.payload)!.bin);
    for (const game of ['daily_quiz', 'origin'] as const) {
      for (const i of pack.games[game]) {
        const p = readChoicePayload(i.payload)!;
        expect(p).not.toBeNull();
        expect(p.answer).toBeGreaterThanOrEqual(0);
        expect(p.answer).toBeLessThan(p.options.length);
      }
    }
  });

  it('lời giải thích 1–220 ký tự', () => {
    for (const i of allItems()) {
      expect(i.explanation.length).toBeGreaterThan(0);
      expect(i.explanation.length).toBeLessThanOrEqual(MINI_EXPLANATION_MAX);
    }
  });

  it('productSlug và slug của đề Giỏ Đúng Việc đều có trong ảnh chụp danh sách sản phẩm', () => {
    const snapshot = new Set(pack.products.map((p) => p.slug));
    for (const i of allItems().filter((x) => x.productSlug)) expect(snapshot.has(i.productSlug!)).toBe(true);
    for (const i of pack.games.basket) {
      const p = readBasketPayload(i.payload)!;
      for (const s of [...p.correct, ...p.wrong.map((w) => w.slug)]) expect(`${i.id} ${s} ${snapshot.has(s)}`).toBe(`${i.id} ${s} true`);
    }
  });

  it('Giỏ Đúng Việc: ít nhất 12 đề bật, mỗi đề 3 món đúng + 3 món sai có lý do, cả 6 món còn hàng lúc chụp', () => {
    const active = pack.games.basket.filter((i) => i.active);
    expect(active.length).toBeGreaterThanOrEqual(12);
    const inStock = new Set(pack.products.filter((p) => p.inStock).map((p) => p.slug));
    for (const i of active) {
      const p = readBasketPayload(i.payload)!;
      expect(p.correct).toHaveLength(MINI_BASKET_PICK);
      expect(p.wrong).toHaveLength(MINI_BASKET_PICK);
      for (const w of p.wrong) expect(w.reason.trim().length).toBeGreaterThan(5);
      expect([...p.correct, ...p.wrong.map((w) => w.slug)].filter((s) => !inStock.has(s))).toEqual([]);
    }
  });

  it('câu cũ được gắn nguồn đều có trong seed game_quizzes và qua được bộ chuyển trắc nghiệm', () => {
    expect(pack.legacy.length).toBeGreaterThan(0);
    for (const l of pack.legacy) {
      const q = legacyById.get(l.id);
      expect(q).toBeDefined();
      expect(readChoicePayload({ prompt: q!.question, options: q!.options, answer: q!.correct })).not.toBeNull();
    }
  });

  it('mọi nguồn trong sources.json có hạng A, B, C hoặc label và ngày kiểm', () => {
    for (const s of pack.sources) {
      expect(['A', 'B', 'C', 'label']).toContain(s.grade);
      expect(s.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const used = new Set([...allItems().filter((i) => i.game !== 'basket').map((i) => i.sourceUrl), ...pack.legacy.map((l) => l.sourceUrl)]);
    const known = new Set(pack.sources.map((s) => s.url));
    expect([...used].filter((u) => !known.has(u))).toEqual([]);
  });
});

describe('cụm cấm', () => {
  it.each([
    ['diệt khuẩn', 'Sản phẩm diệt khuẩn tốt'],
    ['diệt virus', 'diệt virus trên bề mặt'],
    ['99,9%', 'loại bỏ 99,9% vi khuẩn'],
    ['99.9 %', 'sạch 99.9 % vết bẩn'],
    ['chữa', 'giúp chữa ho'],
    ['điều trị', 'hỗ trợ điều trị mụn'],
    ['trị', 'trị gàu hiệu quả'],
    ['ngừa bệnh', 'giúp ngừa bệnh'],
    ['phòng bệnh', 'dùng để phòng bệnh'],
    ['an toàn tuyệt đối', 'An toàn tuyệt đối cho bé'],
    ['an toàn hoàn toàn', 'an toàn hoàn toàn'],
    ['không hoá chất (kiểu mới)', 'không hoá chất'],
    ['không hóa chất (kiểu cũ)', 'Không hóa chất độc hại'],
    ['không chứa hoá chất', 'không chứa hoá chất'],
    ['100% tự nhiên', '100% tự nhiên'],
    ['100 % thiên nhiên', 'thành phần 100 % thiên nhiên'],
    ['kháng khuẩn', 'có tính kháng khuẩn'],
    ['vô hại', 'hoàn toàn vô hại'],
    ['đuổi muỗi', 'giúp đuổi muỗi'],
    ['thân thiện môi trường', 'thân thiện với môi trường'],
    ['phân huỷ hoàn toàn', 'phân huỷ hoàn toàn'],
    ['phân hủy sinh học hoàn toàn', 'phân hủy sinh học hoàn toàn'],
    ['tốt nhất', 'loại tốt nhất'],
    ['nhựa 450 năm', 'chai nhựa mất 450 năm để phân huỷ'],
    ['3,9 triệu tấn', 'mỗi năm thải 3,9 triệu tấn'],
    ['33% tái chế', 'chỉ 33% nhựa được tái chế'],
    ['refill 90%', 'refill giảm 90% nhựa'],
    ['44% bao bì', 'giảm 44% bao bì'],
    ['EPR 22%', 'tỷ lệ tái chế PET 22%'],
    ['nhựa 1, 2, 5', 'nhựa số 1, 2, 5 tái chế được'],
    ['CMC bồ hòn', 'CMC 0,032'],
    ['axit axetic eco-enzyme', 'axit axetic 1,08%'],
    ['khử khuẩn', 'nước rửa tay khử khuẩn'],
    ['sát trùng', 'giúp sát trùng vết xước'],
    ['tẩy trùng', 'tẩy trùng bồn cầu'],
    ['diệt sạch vi khuẩn', 'diệt sạch vi khuẩn'],
    ['diệt được vi khuẩn', 'diệt được vi khuẩn'],
    ['diệt 99% vi khuẩn', 'diệt 99% vi khuẩn'],
    ['99,99%', 'loại 99,99% vi khuẩn'],
    ['100% từ thiên nhiên', 'chiết xuất 100% từ thiên nhiên'],
    ['100% nguồn gốc tự nhiên', '100% nguồn gốc tự nhiên'],
    ['hoàn toàn tự nhiên', 'thành phần hoàn toàn tự nhiên'],
    ['tự nhiên 100%', 'tự nhiên 100%'],
    ['tự phân hủy 100%', 'túi tự phân hủy 100%'],
    ['0% hoá chất', '0% hoá chất'],
    ['không chứa chất hoá học', 'không chứa chất hoá học'],
    ['điều trị an toàn', 'điều trị an toàn cho da'],
    ['phòng dịch bệnh', 'phòng dịch bệnh mùa mưa'],
    ['chữ dựng sẵn (NFD)', 'diệt khuẩn'.normalize('NFD')],
  ])('bắt: %s', (_label, text) => {
    expect(findBannedPhrases(text).length).toBeGreaterThan(0);
  });

  it.each([
    ['giá trị', 'giá trị dinh dưỡng'],
    ['trị số', 'trị số pH'],
    ['quản trị', 'quản trị cửa hàng'],
    ['sửa chữa', 'sửa chữa đồ cũ thay vì mua mới'],
    ['phòng khách', 'lau sàn phòng khách'],
    ['90% không nói về refill', 'khoảng 90% tinh dầu vỏ quế là cinnamaldehyde'],
    ['~90% đứng một mình', '~90%'],
    ['90,4%', 'chiếm 90,4%'],
    ['an toàn khi dùng đúng nhãn', 'an toàn khi dùng đúng hướng dẫn trên nhãn'],
    ['hoá chất nói trung tính', 'Pin chứa hoá chất nên bỏ thùng nguy hại'],
    ['thuỷ tinh', 'Thuỷ tinh tái chế được nhiều lần'],
    ['chữa cháy', 'Bình chữa cháy mini đã hết hạn'],
    ['hồ Trị An', 'nước hồ Trị An'],
    ['phòng dịch vụ', 'phòng dịch vụ khách hàng'],
    ['giá có 0.81 ở giữa', 'giá 150.810đ'],
    ['10,81', 'chiếm 10,81%'],
    ['diệt nhưng không nói vi sinh vật', 'Diệt sâu hại trong đất'],
  ])('không bắt: %s', (_label, text) => {
    expect(findBannedPhrases(text)).toEqual([]);
  });

  it('bắt cả cụm nằm trong lựa chọn, nhãn và lý do sai của đề, không chỉ lời giải thích', () => {
    expect(visibleTexts({ payload: { prompt: 'Câu?', options: ['diệt khuẩn', 'b'], answer: 1 }, explanation: 'ok' })).toContain('diệt khuẩn');
    const texts = visibleTexts({
      payload: { task: 'Việc', correct: ['a-b'], wrong: [{ slug: 'c-d', reason: 'vô hại' }] },
      explanation: 'ok',
    });
    expect(texts).toContain('vô hại');
    expect(texts).not.toContain('a-b');
    expect(texts).not.toContain('c-d');
  });
});

describe('bộ kiểm gói bắt lỗi', () => {
  const firstActive = (p: GameMiniPack, game: MiniGameId) => p.games[game].find((i) => i.active)!;

  it.each<[string, (p: GameMiniPack) => void, RegExp]>([
    ['sourceUrl http', (p) => (firstActive(p, 'sort').sourceUrl = 'http://example.org/x'), /https/],
    ['sourceUrl lạ ngoài sources.json', (p) => (firstActive(p, 'origin').sourceUrl = 'https://example.org/x'), /sources\.json/],
    ['câu khoa học dẫn trang Tubu', (p) => (firstActive(p, 'match').sourceUrl = 'https://tubutree.com/san-pham/x'), /trang Tubu/],
    ['cụm cấm trong lời giải thích', (p) => (firstActive(p, 'daily_quiz').explanation = 'Diệt khuẩn 99,9%.'), /cụm cấm/],
    ['đáp án ngoài lựa chọn', (p) => ((firstActive(p, 'origin').payload as { answer: number }).answer = 9), /Đoán Xuất Xứ cần/],
    ['trùng id giữa hai game', (p) => (firstActive(p, 'match').id = firstActive(p, 'sort').id), /id phải|trùng id/],
    ['productSlug không có trong ảnh chụp', (p) => (firstActive(p, 'origin').productSlug = 'khong-co-san-pham-nay'), /ảnh chụp/],
    ['giải thích quá 220 ký tự', (p) => (firstActive(p, 'sort').explanation = 'a'.repeat(221)), /giải thích/],
    [
      'mục tắt thiếu lý do',
      (p) => {
        const i = firstActive(p, 'sort');
        i.active = false;
        delete i.inactiveReason;
      },
      /inactiveReason/,
    ],
    [
      'đề giỏ có món hết hàng',
      (p) => {
        const out = p.products.find((x) => !x.inStock)!;
        (firstActive(p, 'basket').payload as { wrong: { slug: string }[] }).wrong[0]!.slug = out.slug;
      },
      /hết hàng/,
    ],
    ['version không phải số nguyên dương', (p) => (firstActive(p, 'match').version = 0), /version/],
  ])('%s', (_name, mutate, expected) => {
    const p = clone();
    mutate(p);
    const errors = validateGameMiniPack(p);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(expected);
  });

  it('Đố Xanh có 1–2 câu bật gắn sản phẩm: lỗi (câu thứ 3 sẽ lặp mỗi ngày)', () => {
    const p = clone();
    const slug = p.products.find((x) => x.inStock)!.slug;
    p.games.daily_quiz.filter((i) => i.active).slice(0, 2).forEach((i) => (i.productSlug = slug));
    expect(validateGameMiniPack(p).join('\n')).toMatch(/gắn sản phẩm; cần 0 hoặc ít nhất 3/);
    p.games.daily_quiz.filter((i) => i.active)[2]!.productSlug = slug;
    expect(validateGameMiniPack(p)).toEqual([]);
  });

  it('câu cũ gắn nguồn: phải có trong seed-game-quiz.ts và chữ không mang cụm cấm', () => {
    const base = QUIZZES.filter((q) => pack.legacy.some((l) => l.id === q.id));
    expect(validateGameMiniPack(pack, base)).toEqual([]);
    expect(validateGameMiniPack(pack, base.slice(1)).join('\n')).toMatch(/không có trong seed-game-quiz\.ts/);
    const dirty = base.map((q, i) => (i === 0 ? { ...q, explanation: `${q.explanation} Phân huỷ hoàn toàn trong 400 năm.` } : q));
    expect(validateGameMiniPack(pack, dirty).join('\n')).toMatch(/legacy-quiz-sources\.json .*cụm cấm "phân huỷ hoàn toàn"/);
  });

  it('lệnh seed không nhận tham số', () => {
    expect(() => parseGameMiniArgs([])).not.toThrow();
    expect(() => parseGameMiniArgs(['--'])).not.toThrow();
    expect(() => parseGameMiniArgs(['--force'])).toThrow(/không nhận tham số/);
  });
});

describe('mỗi game chơi trọn một ván bằng nội dung thật', () => {
  it.each(GAMES)('%s: pick → build → nộp đáp án đúng → chấm đủ điểm, nhiều hạt giống và nhiều ngày', (game) => {
    const def = MINI_GAMES[game];
    const pool = poolOf(game);
    const sortHazardous = game === 'sort' && pool.some((r) => readSortPayload(r.payload)?.bin === 'hazardous');
    const usable = pool.filter((r) => def.usable(r, { rng: Math.random, dayKey: days[0]!, products }));
    expect(usable.length).toBe(pool.length);
    const seen = new Set<string>();

    for (let seed = 1; seed <= 60; seed++) {
      const dayKey = days[seed % days.length]!;
      const ctx = buildCtx(seeded(seed), dayKey, sortHazardous);
      const rows = def.pick(pool, ctx);
      expect(rows).not.toBeNull();
      const expectedSize = game === 'basket' ? 1 : MINI_GAME_RULES[game].items;
      expect(rows!).toHaveLength(expectedSize);
      expect(new Set(rows!.map((r) => r.id)).size).toBe(rows!.length);
      rows!.forEach((r) => seen.add(r.id));

      const content = def.build(rows!, ctx);
      const wire = JSON.stringify(content);
      expect(wire).not.toMatch(/"(?:bin|answer|correct|wrong|reason|explanation|sourceUrl)"/);
      if (content.game === 'sort') expect(content.bins.includes('hazardous')).toBe(sortHazardous);
      if (content.game === 'basket') expect(content.task.products).toHaveLength(MINI_BASKET_PICK * 2);
      if (content.game === 'match') {
        const labels = (side: 'ingredient' | 'use') => content.cards.filter((c) => c.side === side).map((c) => c.label.toLowerCase());
        expect(new Set(labels('ingredient')).size).toBe(rows!.length);
        expect(new Set(labels('use')).size).toBe(rows!.length);
      }

      const answers = def.parseAnswers(correctAnswers(game, rows!, ctx), rows!, ctx);
      expect(answers).not.toBeNull();
      const grade = def.grade(rows!, answers, ctx);
      expect(grade.correct).toBe(grade.total);
      expect(grade.review.items.every((i) => i.correct)).toBe(true);
      for (const item of grade.review.items) {
        expect(item.sourceUrl.startsWith('https://')).toBe(true);
        expect(item.explanation.length).toBeGreaterThan(0);
      }
    }
    if (game !== 'daily_quiz') expect(seen.size).toBeGreaterThan(Math.min(pool.length, 20) / 2);
  });

  it('Đố Xanh: 90 ngày liền ngày nào cũng đủ 3 câu khác nhau, hai ngày liền không trùng bộ, mọi câu đều được ra', () => {
    const pool = poolOf('daily_quiz');
    const shown = new Set<string>();
    let previous = '';
    for (const dayKey of days) {
      const rows = MINI_GAMES.daily_quiz.pick(pool, buildCtx(seeded(1), dayKey, false))!;
      expect(rows).toHaveLength(MINI_GAME_RULES.daily_quiz.items);
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
      const key = rows.map((r) => r.id).join('|');
      expect(key).not.toBe(previous);
      previous = key;
      rows.forEach((r) => shown.add(r.id));
    }
    expect(pool.filter((r) => !shown.has(r.id)).map((r) => r.id)).toEqual([]);
  });
});
