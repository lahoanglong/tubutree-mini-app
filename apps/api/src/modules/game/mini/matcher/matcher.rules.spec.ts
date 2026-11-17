import {
  MATCHER_MAX_ITEMS,
  allAnswerPaths,
  fillSlots,
  matcherContentGaps,
  matcherPayloadError,
  pickOutcome,
  planSlots,
  questionFor,
  readMatcherOutcome,
  readMatcherQuestion,
  readMatcherTrivia,
  resolveChain,
  sizeOf,
  sortQuestions,
  type MatcherOutcome,
  type MatcherQuestion,
} from './matcher.rules';

const opt = (value: string, tags: string[]) => ({ value, label: `Nhãn ${value}`, tags });

const Q_NEED = { code: 'need', step: 1, prompt: 'Góc nào?', options: [opt('laundry', ['laundry']), opt('kitchen', ['kitchen'])] };
const Q_LAUNDRY = { code: 'laundry_who', step: 2, prompt: 'Giặt gì?', options: [opt('family', ['adult']), opt('kids', ['kids'])], when: ['laundry'] };
const Q_KITCHEN = { code: 'kitchen_how', step: 2, prompt: 'Rửa chén?', options: [opt('hand', ['hand']), opt('machine', ['machine'])], when: ['kitchen'] };
const Q_SIZE = { code: 'size', step: 3, prompt: 'Cỡ nào?', options: [opt('small', ['small']), opt('refill', ['refill'])] };

const questions = (): MatcherQuestion[] => sortQuestions([Q_SIZE, Q_KITCHEN, Q_NEED, Q_LAUNDRY].map((q) => readMatcherQuestion(q)!));

const slot = (pick: Record<string, string[]>, extra: Record<string, unknown> = {}) => ({ pick, why: [{ tag: null, text: 'Câu mặc định.' }], ...extra });

const outcome = (code: string, need: string, require: string[], slots: unknown[]): MatcherOutcome =>
  readMatcherOutcome({ code, title: `Bộ ${code}`, need, require, slots, fallbackCategory: 'tay-rua-sinh-hoc' })!;

const OUTCOMES = (): MatcherOutcome[] => [
  outcome('laundry_family', 'laundry', [], [slot({ small: ['giat-nho'], refill: ['giat-refill'], any: ['giat-500'] }), slot({ any: ['do-lot'] })]),
  outcome('laundry_kids', 'laundry', ['kids'], [slot({ any: ['giat-be'] }), slot({ any: ['giat-500'] })]),
  outcome('kitchen_any', 'kitchen', [], [slot({ any: ['rua-chen'] }), slot({ any: ['lau-bep'] })]),
];

describe('đọc payload Chọn Chuẩn Xanh', () => {
  it('câu nhu cầu hợp lệ; câu bước 1 không được có when; lựa chọn trùng hay thiếu nhãn là hỏng', () => {
    expect(readMatcherQuestion(Q_NEED)).not.toBeNull();
    expect(readMatcherQuestion({ ...Q_NEED, when: ['laundry'] })).toBeNull();
    expect(readMatcherQuestion({ ...Q_NEED, options: [opt('a', ['x']), opt('a', ['y'])] })).toBeNull();
    expect(readMatcherQuestion({ ...Q_NEED, options: [opt('a', ['x'])] })).toBeNull();
    expect(readMatcherQuestion({ ...Q_NEED, step: 4 })).toBeNull();
    expect(readMatcherQuestion({ ...Q_LAUNDRY, when: [] })).toBeNull();
    expect(readMatcherQuestion({ ...Q_NEED, options: [opt('a', ['Có Dấu']), opt('b', ['y'])] })).toBeNull();
  });

  it('câu đố: 2–4 lựa chọn, đáp án là chỉ số trong khoảng', () => {
    expect(readMatcherTrivia({ prompt: 'Hỏi?', options: ['A', 'B'], answer: 1 })).toEqual({ prompt: 'Hỏi?', options: ['A', 'B'], answer: 1 });
    expect(readMatcherTrivia({ prompt: 'Hỏi?', options: ['A', 'B'], answer: 2 })).toBeNull();
    expect(readMatcherTrivia({ prompt: 'Hỏi?', options: ['A'], answer: 0 })).toBeNull();
    expect(readMatcherTrivia({ prompt: 'Hỏi?', options: ['A', 'A'], answer: 0 })).toBeNull();
  });

  it('bộ kết quả: câu "vì sao" mặc định phải có và đứng cuối; khoá cỡ lạ hay slug sai dạng là hỏng', () => {
    const base = { code: 'x', title: 'Bộ', need: 'laundry', require: [], fallbackCategory: 'tay-rua-sinh-hoc' };
    expect(readMatcherOutcome({ ...base, slots: [slot({ any: ['a-b'] })] })).not.toBeNull();
    expect(readMatcherOutcome({ ...base, slots: [{ pick: { any: ['a'] }, why: [{ tag: 'kids', text: 'Có nhãn.' }] }] })).toBeNull();
    expect(
      readMatcherOutcome({ ...base, slots: [{ pick: { any: ['a'] }, why: [{ tag: null, text: 'Mặc định.' }, { tag: 'kids', text: 'Sau.' }] }] }),
    ).toBeNull();
    expect(readMatcherOutcome({ ...base, slots: [slot({ huge: ['a'] })] })).toBeNull();
    expect(readMatcherOutcome({ ...base, slots: [slot({ any: ['Sai Slug'] })] })).toBeNull();
    expect(readMatcherOutcome({ ...base, slots: [] })).toBeNull();
  });

  it('matcherPayloadError: null khi hợp lệ, có lời khi hỏng hay sai loại', () => {
    expect(matcherPayloadError('question', Q_NEED)).toBeNull();
    expect(matcherPayloadError('question', { code: 'x' })).toMatch(/Câu nhu cầu/);
    expect(matcherPayloadError('trivia', { prompt: 'x' })).toMatch(/.+/);
    expect(matcherPayloadError('outcome', {})).toMatch(/Bộ kết quả/);
    expect(matcherPayloadError('khac', {})).toMatch(/.+/);
  });
});

describe('rẽ nhánh và dựng lại chuỗi đáp án', () => {
  it('bước 2 theo nhãn của câu 1', () => {
    const qs = questions();
    expect(questionFor(qs, 2, new Set(['laundry']))?.code).toBe('laundry_who');
    expect(questionFor(qs, 2, new Set(['kitchen']))?.code).toBe('kitchen_how');
    expect(questionFor(qs, 2, new Set())).toBeNull();
  });

  it('resolveChain: đủ 3 câu đúng nhánh thì gộp nhãn; thứ tự gửi không quan trọng', () => {
    const chain = resolveChain(questions(), [
      { code: 'size', value: 'refill' },
      { code: 'need', value: 'laundry' },
      { code: 'laundry_who', value: 'kids' },
    ]);
    expect(chain?.picks.map((p) => p.question.code)).toEqual(['need', 'laundry_who', 'size']);
    expect([...chain!.tags].sort()).toEqual(['kids', 'laundry', 'refill']);
  });

  it('resolveChain: câu sai nhánh, lựa chọn lạ, thiếu hay thừa câu, trùng câu là null', () => {
    const qs = questions();
    expect(resolveChain(qs, [{ code: 'need', value: 'laundry' }, { code: 'kitchen_how', value: 'hand' }, { code: 'size', value: 'small' }])).toBeNull();
    expect(resolveChain(qs, [{ code: 'need', value: 'garden' }, { code: 'laundry_who', value: 'kids' }, { code: 'size', value: 'small' }])).toBeNull();
    expect(resolveChain(qs, [{ code: 'need', value: 'laundry' }, { code: 'laundry_who', value: 'kids' }])).toBeNull();
    expect(
      resolveChain(qs, [
        { code: 'need', value: 'laundry' },
        { code: 'laundry_who', value: 'kids' },
        { code: 'size', value: 'small' },
        { code: 'kitchen_how', value: 'hand' },
      ]),
    ).toBeNull();
    expect(resolveChain(qs, [{ code: 'need', value: 'laundry' }, { code: 'need', value: 'laundry' }, { code: 'size', value: 'small' }])).toBeNull();
  });

  it('allAnswerPaths liệt kê đủ tổ hợp: 2 nhu cầu × 2 lựa chọn × 2 cỡ', () => {
    expect(allAnswerPaths(questions())).toHaveLength(8);
  });

  it('matcherContentGaps: đủ nhánh là rỗng; bỏ bộ của bếp thì báo đúng nhánh; thiếu câu bước 2 thì báo', () => {
    expect(matcherContentGaps(questions(), OUTCOMES())).toEqual([]);
    const gaps = matcherContentGaps(questions(), OUTCOMES().filter((o) => o.need !== 'kitchen'));
    expect(gaps).toHaveLength(4);
    expect(gaps.every((g) => g.includes('need=kitchen') && g.includes('không có bộ'))).toBe(true);
    const noKitchenQ = questions().filter((q) => q.code !== 'kitchen_how');
    expect(matcherContentGaps(noKitchenQ, OUTCOMES()).some((g) => g.includes('need=kitchen') && g.includes('bước 2'))).toBe(true);
    expect(matcherContentGaps([], OUTCOMES())).toEqual(['thiếu câu bước 1']);
  });
});

describe('chọn bộ và món', () => {
  it('pickOutcome tất định: bộ khớp nhiều nhãn require hơn thắng; hoà thì mã nhỏ hơn', () => {
    expect(pickOutcome(OUTCOMES(), new Set(['laundry', 'kids', 'small']))?.code).toBe('laundry_kids');
    expect(pickOutcome(OUTCOMES(), new Set(['laundry', 'adult', 'small']))?.code).toBe('laundry_family');
    const twins = [outcome('b_set', 'kitchen', [], [slot({ any: ['x'] })]), outcome('a_set', 'kitchen', [], [slot({ any: ['y'] })])];
    for (let i = 0; i < 5; i++) expect(pickOutcome(i % 2 ? twins : [...twins].reverse(), new Set(['kitchen']))?.code).toBe('a_set');
    expect(pickOutcome(OUTCOMES(), new Set(['garden']))).toBeNull();
  });

  it('sizeOf lấy nhãn cỡ trong đáp án', () => {
    expect(sizeOf(new Set(['laundry', 'refill']))).toBe('refill');
    expect(sizeOf(new Set(['laundry']))).toBeNull();
  });

  it('planSlots: ứng viên theo cỡ trước rồi ứng viên chung; bỏ vị trí when không khớp; vị trí lead lên đầu; câu vì sao theo nhãn', () => {
    const o = outcome('x', 'laundry', [], [
      slot({ small: ['giat-nho'], any: ['giat-500'] }, { why: [{ tag: 'small', text: 'Bạn chọn dùng thử.' }, { tag: null, text: 'Mặc định.' }] }),
      slot({ any: ['do-lot'] }, { when: 'delicate' }),
      slot({ any: ['giat-be'] }, { lead: 'kids' }),
    ]);
    expect(planSlots(o, new Set(['laundry', 'small']))).toEqual([
      { candidates: ['giat-nho', 'giat-500'], why: 'Bạn chọn dùng thử.' },
      { candidates: ['giat-be'], why: 'Câu mặc định.' },
    ]);
    expect(planSlots(o, new Set(['laundry', 'kids', 'delicate'])).map((s) => s.candidates[0])).toEqual(['giat-be', 'giat-500', 'do-lot']);
    expect(planSlots(o, new Set(['laundry', 'refill']))[0]).toEqual({ candidates: ['giat-500'], why: 'Mặc định.' });
  });

  it('fillSlots: bỏ món hết hàng sang ứng viên kế, không lặp món, bỏ vị trí không còn ứng viên, tối đa 4 món', () => {
    const plan = [
      { candidates: ['a', 'b'], why: '1' },
      { candidates: ['b', 'c'], why: '2' },
      { candidates: ['z'], why: '3' },
      { candidates: ['d'], why: '4' },
      { candidates: ['e'], why: '5' },
      { candidates: ['f'], why: '6' },
    ];
    expect(fillSlots(plan, (s) => s !== 'a' && s !== 'z')).toEqual([
      { slug: 'b', why: '1' },
      { slug: 'c', why: '2' },
      { slug: 'd', why: '4' },
      { slug: 'e', why: '5' },
    ]);
    expect(fillSlots(plan, () => true)).toHaveLength(MATCHER_MAX_ITEMS);
    expect(fillSlots(plan, () => false)).toEqual([]);
  });
});
