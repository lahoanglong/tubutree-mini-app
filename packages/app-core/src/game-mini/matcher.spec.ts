import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { claimsIn } from '../commerce/copy-claims-guard';
import { GAME_MINI_COPY_MAX, gameCopy } from './copy';
import { miniWebOnlyLine } from './format';
import { MATCHER_COPY, MATCHER_COPY_MAX, matcherCopy, type MatcherCopyKey } from './matcher-copy';
import { matcherOn } from './matcher-status';
import {
  MATCHER_FLOW_LENGTH,
  MATCHER_PENDING_TTL_MS,
  classifyMatcherError,
  decodeMatcherPending,
  encodeMatcherPending,
  matcherAnswer,
  matcherAnswers,
  matcherBack,
  matcherCartLines,
  matcherChooseTrivia,
  matcherCurrent,
  matcherDone,
  matcherItemName,
  matcherItemView,
  matcherNext,
  matcherQuestionAt,
  matcherSeconds,
  matcherStart,
  matcherTotal,
  matcherWhy,
  pickMatcherTrivia,
  type MatcherItem,
  type MatcherQuestion,
  type MatcherResult,
  type MatcherTrivia,
} from './matcher';

const q = (code: string, step: number, options: Array<[string, string[]]>, when: string[] | null = null): MatcherQuestion => ({
  code,
  step,
  prompt: `Câu ${code}`,
  options: options.map(([value, tags]) => ({ value, label: value, tags })),
  when,
});

/** Cùng hình dạng nội dung thật: câu 1 rẽ nhánh, câu 2 theo nhu cầu, câu 3 theo nhóm. Thứ tự lộn để kiểm sắp theo bước rồi mã. */
const QUESTIONS: MatcherQuestion[] = [
  q('size_home', 3, [['small', ['small']], ['large', ['large']]], ['laundry', 'kitchen']),
  q('kitchen_how', 2, [['hand', ['hand']], ['machine', ['machine']]], ['kitchen']),
  q('need', 1, [['laundry', ['laundry']], ['kitchen', ['kitchen']], ['baby', ['baby']]]),
  q('laundry_who', 2, [['family', ['adult']], ['kids', ['kids']]], ['laundry']),
  q('baby_focus', 2, [['bottle', ['bottle']]], ['baby']),
  q('size_care', 3, [['small', ['small']]], ['baby']),
];

const trivia = (id: string): MatcherTrivia => ({
  id,
  prompt: `Đố ${id}`,
  options: ['A', 'B', 'C'],
  answer: 1,
  explanation: 'Giải thích.',
  sourceUrl: 'https://example.org/x',
});

const item = (over: Partial<MatcherItem> = {}): MatcherItem => ({
  slug: 'nuoc-giat-fuwa3e-1l',
  productId: 'p1',
  variationId: 'v1',
  name: 'Nước giặt',
  variationName: null,
  imageUrl: '/img/product/p1/thumb',
  price: 120_000,
  compareAtPrice: null,
  flash: false,
  why: 'Hợp máy giặt cửa trước.',
  ...over,
});

const result = (over: Partial<MatcherResult> = {}): MatcherResult => {
  const items = over.items ?? [item(), item({ slug: 'nuoc-xa-vai-1l', productId: 'p2', variationId: 'v2', price: 80_000 })];
  return { outcomeId: 'gm-matcher-o-laundry-family', code: 'laundry_family', title: 'Bộ giặt cả nhà', fallback: false, items, total: 200_000, water: 4, ...over };
};

/** Đi hết 5 bước với các đáp án cho trước; câu đố chọn 0. */
function play(values: string[]) {
  let s = matcherStart();
  const vs = [...values];
  while (!matcherDone(s)) {
    const cur = matcherCurrent(s)!;
    s = cur.kind === 'question' ? matcherAnswer(QUESTIONS, s, vs.shift()!) : matcherNext(QUESTIONS, matcherChooseTrivia(s, 0));
  }
  return s;
}

describe('Chọn Chuẩn Xanh: 5 bước', () => {
  it('thứ tự: câu 1, đố, câu 2, đố, câu 3; xong là đủ 3 đáp án đúng nhánh', () => {
    let s = matcherStart();
    const kinds: string[] = [];
    while (!matcherDone(s)) {
      const cur = matcherCurrent(s)!;
      kinds.push(cur.kind === 'question' ? `q${cur.step}` : `t${cur.slot}`);
      s = cur.kind === 'question' ? matcherAnswer(QUESTIONS, s, ['kitchen', 'machine', 'large'][cur.step - 1]!) : matcherNext(QUESTIONS, matcherChooseTrivia(s, 2));
    }
    expect(kinds).toEqual(['q1', 't0', 'q2', 't1', 'q3']);
    expect(s.index).toBe(MATCHER_FLOW_LENGTH);
    expect(matcherAnswers(QUESTIONS, s)).toEqual([
      { code: 'need', value: 'kitchen' },
      { code: 'kitchen_how', value: 'machine' },
      { code: 'size_home', value: 'large' },
    ]);
  });

  it('rẽ nhánh theo câu 1: câu 2 và câu 3 đổi theo nhu cầu', () => {
    const s = matcherAnswer(QUESTIONS, matcherStart(), 'baby');
    expect(matcherQuestionAt(QUESTIONS, s, 2)?.code).toBe('baby_focus');
    expect(matcherQuestionAt(QUESTIONS, matcherAnswer(QUESTIONS, matcherStart(), 'laundry'), 2)?.code).toBe('laundry_who');
    expect(matcherAnswers(QUESTIONS, play(['baby', 'bottle', 'small']))!.map((a) => a.code)).toEqual(['need', 'baby_focus', 'size_care']);
  });

  it('câu đố: phải chọn mới đi tiếp; chọn rồi thì khoá; câu nhu cầu không nhận giá trị lạ', () => {
    let s = matcherAnswer(QUESTIONS, matcherStart(), 'kitchen');
    expect(matcherNext(QUESTIONS, s)).toBe(s);
    s = matcherChooseTrivia(s, 1);
    expect(matcherChooseTrivia(s, 2).trivia).toEqual({ 0: 1 });
    s = matcherNext(QUESTIONS, s);
    expect(matcherCurrent(s)).toEqual({ kind: 'question', step: 2 });
    expect(matcherAnswer(QUESTIONS, s, 'khong-co')).toBe(s);
    expect(matcherChooseTrivia(s, 0)).toBe(s);
  });

  it('quay lại giữ đáp án: lùi tới câu 1 rồi Tiếp không cần chọn lại; đổi nhánh rồi đổi về thấy lại lựa chọn cũ', () => {
    let s = play(['kitchen', 'machine', 'large']);
    for (let i = 0; i < 5; i++) s = matcherBack(s);
    expect(s.index).toBe(0);
    expect(matcherBack(s)).toBe(s);
    expect(matcherNext(QUESTIONS, s).index).toBe(1);
    s = matcherAnswer(QUESTIONS, s, 'laundry');
    expect(matcherAnswers(QUESTIONS, s)).toBeNull();
    s = matcherNext(QUESTIONS, s);
    expect(matcherNext(QUESTIONS, s).index).toBe(2);
    s = matcherBack(matcherBack(s));
    s = matcherAnswer(QUESTIONS, s, 'kitchen');
    expect(s.answers).toMatchObject({ need: 'kitchen', kitchen_how: 'machine', size_home: 'large' });
    expect(matcherAnswers(QUESTIONS, s)).toEqual([
      { code: 'need', value: 'kitchen' },
      { code: 'kitchen_how', value: 'machine' },
      { code: 'size_home', value: 'large' },
    ]);
  });

  it('đáp án của nhánh đã bỏ không được gửi', () => {
    let s = play(['laundry', 'kids', 'small']);
    for (let i = 0; i < 5; i++) s = matcherBack(s);
    s = matcherAnswer(QUESTIONS, s, 'kitchen');
    expect(matcherAnswers(QUESTIONS, s)).toBeNull();
    expect(Object.keys(s.answers).sort()).toEqual(['laundry_who', 'need', 'size_home']);
  });

  it('nhánh thiếu câu (nội dung hở) thì không ra đáp án', () => {
    const qs = QUESTIONS.filter((x) => x.code !== 'baby_focus');
    const s = matcherAnswer(qs, matcherStart(), 'baby');
    expect(matcherQuestionAt(qs, s, 2)).toBeNull();
    expect(matcherAnswers(qs, s)).toBeNull();
  });

  it('chọn 2 câu đố khác nhau, tất định theo seed', () => {
    const all = ['a', 'b', 'c', 'd', 'e'].map(trivia);
    for (let seed = 0; seed < 60; seed++) {
      const [x, y] = pickMatcherTrivia(all, seed);
      expect(x!.id).not.toBe(y!.id);
      expect(pickMatcherTrivia(all, seed)).toEqual([x, y]);
    }
    expect(new Set(Array.from({ length: 40 }, (_, s) => pickMatcherTrivia(all, s).map((t) => t.id).join())).size).toBeGreaterThan(5);
    expect(pickMatcherTrivia(all.slice(0, 2), 9)).toHaveLength(2);
    expect(pickMatcherTrivia(all, -7)).toHaveLength(2);
  });

  it('giây gửi analytics: tròn 5, kẹp 0..3600', () => {
    expect(matcherSeconds(0)).toBe(0);
    expect(matcherSeconds(42_400)).toBe(40);
    expect(matcherSeconds(42_600)).toBe(45);
    expect(matcherSeconds(-5)).toBe(0);
    expect(matcherSeconds(10 * 3_600_000)).toBe(3600);
  });
});

describe('Chọn Chuẩn Xanh: kết quả', () => {
  it('tổng = cộng giá từng món; dòng giỏ mỗi món 1 cái', () => {
    const r = result();
    expect(matcherTotal(r.items)).toBe(200_000);
    expect(matcherCartLines(r.items)).toEqual([
      { variationId: 'v1', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
    ]);
  });

  it('vì sao hợp: dùng câu máy chủ; bộ dự phòng (rỗng) dùng câu chung', () => {
    expect(matcherWhy(item())).toBe('Hợp máy giặt cửa trước.');
    expect(matcherWhy(item({ why: '  ' }))).toBe(matcherCopy('result.whyFallback'));
  });

  it('thẻ dòng: tên kèm phân loại, giá gạch chỉ khi có giá niêm yết cao hơn', () => {
    expect(matcherItemName(item({ variationName: '3,5L' }))).toBe('Nước giặt · 3,5L');
    const plain = matcherItemView(item(), 0);
    expect(plain.name).toBe('Nước giặt');
    expect(plain).toMatchObject({ slug: 'nuoc-giat-fuwa3e-1l', price: 120_000, compareAt: null, label: null, imageBadge: null });
    const sale = matcherItemView(item({ price: 100_000, compareAtPrice: 120_000 }), 0);
    expect(sale).toMatchObject({ price: 100_000, compareAt: 120_000 });
  });

  it('phân loại lỗi: mã nghiệp vụ, 404 là tắt, 4xx là đáp án hỏng, còn lại là mạng', () => {
    expect(classifyMatcherError({ status: 404, code: 'GAME_DISABLED' })).toBe('disabled');
    expect(classifyMatcherError({ response: { status: 404, data: { code: 'GAME_NO_CONTENT' } } })).toBe('no_content');
    expect(classifyMatcherError({ status: 400, code: 'ANSWERS_INVALID' })).toBe('invalid');
    expect(classifyMatcherError({ status: 404 })).toBe('disabled');
    expect(classifyMatcherError({ status: 400 })).toBe('invalid');
    expect(classifyMatcherError({ status: 429 })).toBe('network');
    expect(classifyMatcherError(new Error('x'))).toBe('network');
  });

  it('cờ: chỉ enabled === true mới mở', () => {
    expect(matcherOn({ enabled: true })).toBe(true);
    expect(matcherOn({ enabled: false })).toBe(false);
    expect(matcherOn(undefined)).toBe(false);
  });
});

describe('Chọn Chuẩn Xanh: bộ chờ khi sang đăng nhập', () => {
  it('ghi rồi đọc lại đúng bộ, Giọt nước về 0 (không hiện thưởng lần hai)', () => {
    const r = result();
    const back = decodeMatcherPending(encodeMatcherPending(r, 1000), 2000);
    expect(back).toEqual({ ...r, water: 0 });
  });

  it('quá hạn, hỏng, sai dạng hay giờ tương lai thì bỏ', () => {
    const raw = encodeMatcherPending(result(), 1000);
    expect(decodeMatcherPending(raw, 1000 + MATCHER_PENDING_TTL_MS + 1)).toBeNull();
    expect(decodeMatcherPending(raw, 500)).toBeNull();
    expect(decodeMatcherPending('{', 1000)).toBeNull();
    expect(decodeMatcherPending(null, 1000)).toBeNull();
    const bad = (patch: Record<string, unknown>) => JSON.stringify({ at: 1000, result: { ...result(), ...patch } });
    expect(decodeMatcherPending(bad({ items: [] }), 1000)).toBeNull();
    expect(decodeMatcherPending(bad({ items: [item({ slug: '../x' })] }), 1000)).toBeNull();
    expect(decodeMatcherPending(bad({ items: [item({ imageUrl: 'javascript:alert(1)' })] }), 1000)).toBeNull();
    expect(decodeMatcherPending(bad({ items: [item({ imageUrl: '//evil.example/x.png' })] }), 1000)).toBeNull();
    expect(decodeMatcherPending(bad({ items: [item({ price: -1 })] }), 1000)).toBeNull();
    expect(decodeMatcherPending(bad({ items: Array.from({ length: 5 }, () => item()) }), 1000)).toBeNull();
  });

  it('tổng tính lại từ món, không tin tổng trong bộ nhớ trình duyệt', () => {
    const raw = JSON.stringify({ at: 1000, result: { ...result(), total: 1 } });
    expect(decodeMatcherPending(raw, 1000)!.total).toBe(200_000);
  });
});

describe('Chọn Chuẩn Xanh: chữ', () => {
  const keys = Object.keys(MATCHER_COPY) as MatcherCopyKey[];
  const sample = { n: 4, total: 5, a: 'Enzyme protease', host: 'example.org' };

  it('không dùng thuật ngữ cấm và không có lời tuyên bố (mức strict)', () => {
    for (const key of keys) {
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(MATCHER_COPY[key], `${key}: dùng "${use}"`).not.toMatch(pattern);
      expect(claimsIn(matcherCopy(key, sample), 'strict'), key).toEqual([]);
    }
  });

  it('trong ngân sách độ dài sau khi điền biến', () => {
    for (const [key, max] of Object.entries(MATCHER_COPY_MAX) as Array<[MatcherCopyKey, number]>) {
      expect(matcherCopy(key, sample).length, key).toBeLessThanOrEqual(max);
    }
  });

  it('không hứa Giọt nước trước khi chơi: chỉ dòng kết quả nói tới thưởng', () => {
    const promise = keys.filter((k) => /Giọt nước|Điểm Xanh|thưởng/i.test(MATCHER_COPY[k]));
    expect(promise).toEqual(['result.water']);
  });

  it('Mini: tên Chọn Chuẩn Xanh nằm chung dòng "chơi trên tubutree.com", vẫn trong ngân sách khi đủ 4 tên', () => {
    expect(gameCopy('game.matcher.title')).toBe(MATCHER_COPY.title);
    const line = miniWebOnlyLine(['match', 'origin', 'basket'], [gameCopy('game.matcher.title')])!;
    expect(line).toBe('Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc, Chọn Chuẩn Xanh: chơi trên tubutree.com');
    expect(line.length).toBeLessThanOrEqual(GAME_MINI_COPY_MAX['entry.webOnly']!);
    expect(miniWebOnlyLine([], [gameCopy('game.matcher.title')])).toBe('Chọn Chuẩn Xanh: chơi trên tubutree.com');
  });
});
