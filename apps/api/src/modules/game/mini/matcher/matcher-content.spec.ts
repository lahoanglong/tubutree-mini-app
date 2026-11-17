import { claimsIn } from '@tubutree/shared-types';
import { PROD_CATALOG_2026_11_12 as CATALOG } from '../../../../../../../packages/app-core/src/commerce/prod-catalog-full.fixture';
import { loadGameMiniPack, matcherVisibleTexts, validateGameMiniPack, type GameMiniPack } from '../../../../../prisma/seed-game-mini';
import {
  MATCHER_MIN_ITEMS,
  allAnswerPaths,
  fillSlots,
  outcomeSlugs,
  pickOutcome,
  planSlots,
  readMatcherOutcome,
  readMatcherQuestion,
  resolveChain,
  sortQuestions,
  type MatcherOutcome,
  type MatcherQuestion,
} from './matcher.rules';

/** Nội dung thật của Chọn Chuẩn Xanh (`prisma/reference-data/game-mini/matcher.json`), đối chiếu ảnh chụp catalog PROD 12/11. */
const pack = loadGameMiniPack();
const clone = (): GameMiniPack => JSON.parse(JSON.stringify(pack)) as GameMiniPack;
const byKind = (kind: string) => pack.matcher.filter((i) => i.kind === kind);
const questions: MatcherQuestion[] = sortQuestions(byKind('question').map((i) => readMatcherQuestion(i.payload)!));
const outcomes: MatcherOutcome[] = byKind('outcome').map((i) => readMatcherOutcome(i.payload)!);
const inStock = new Set(CATALOG.filter((r) => r.inStock).map((r) => r.slug));
const known = new Set(CATALOG.map((r) => r.slug));

describe('nội dung Chọn Chuẩn Xanh', () => {
  it('đủ 8 câu nhu cầu, 20 câu đố có nguồn, 10 bộ; tất cả tắt, có lý do', () => {
    expect([byKind('question').length, byKind('trivia').length, byKind('outcome').length]).toEqual([8, 20, 10]);
    expect(pack.matcher.filter((i) => i.active !== false)).toEqual([]);
    expect(pack.matcher.filter((i) => !i.inactiveReason?.trim())).toEqual([]);
    expect(validateGameMiniPack(pack)).toEqual([]);
  });

  it('mọi tổ hợp đáp án ra một bộ có ít nhất 2 món còn hàng theo ảnh chụp catalog', () => {
    const paths = allAnswerPaths(questions);
    expect(paths.length).toBeGreaterThanOrEqual(30);
    for (const path of paths) {
      const label = path.map((a) => `${a.code}=${a.value}`).join(', ');
      const chain = resolveChain(questions, path);
      expect(`${label}: ${chain ? 'đủ câu' : 'thiếu câu'}`).toBe(`${label}: đủ câu`);
      const o = pickOutcome(outcomes, chain!.tags);
      expect(`${label}: ${o ? 'có bộ' : 'không bộ'}`).toBe(`${label}: có bộ`);
      const items = fillSlots(planSlots(o!, chain!.tags), (s) => inStock.has(s));
      expect(`${label}: ${items.length >= MATCHER_MIN_ITEMS ? 'đủ món' : `${items.length} món`}`).toBe(`${label}: đủ món`);
      expect(items.every((i) => i.why.length > 0)).toBe(true);
    }
  });

  it('mỗi nhu cầu ra món đúng nhóm: cỡ refill chọn can refill khi có, cỡ nhỏ chọn chai nhỏ', () => {
    const run = (need: string, second: string, size: string) => {
      const q2 = questions.find((q) => q.step === 2 && q.when?.includes(need))!;
      const q3 = questions.find((q) => q.step === 3 && q.when?.includes(need))!;
      const chain = resolveChain(questions, [
        { code: 'need', value: need },
        { code: q2.code, value: second },
        { code: q3.code, value: size },
      ])!;
      return fillSlots(planSlots(pickOutcome(outcomes, chain.tags)!, chain.tags), (s) => inStock.has(s)).map((i) => i.slug);
    };
    expect(run('laundry', 'family', 'refill')[0]).toMatch(/^refill-nuoc-giat-/);
    expect(run('laundry', 'kids', 'small')[0]).toMatch(/^nuoc-giat-cho-be-pineboo-500ml/);
    expect(run('kitchen', 'machine', 'large')).toEqual(expect.arrayContaining(['muoi-rua-chen-cho-may-fuwa3e-2kg-484ca1']));
    expect(run('kitchen', 'produce', 'small')[0]).toMatch(/^nuoc-ngam-rua-thuc-pham-fuwa3e-100ml/);
    expect(run('floor', 'bath', 'refill')[0]).toBe('refill-ve-sinh-bon-cau-fuwa3e-10l-9a032c');
    expect(run('baby', 'bottle', 'small')[0]).toBe('bot-rua-binh-sua-cho-be-pineboo-500ml-91e8c5');
    expect(run('personal', 'hair', 'large')[0]).toBe('dau-goi-dau-xa-qua-bo-po-lang-300g-bef378');
  });

  it('mọi slug trong bộ có trong catalog PROD (prod-catalog-full.fixture.ts) và đang còn hàng lúc chụp', () => {
    const slugs = [...new Set(outcomes.flatMap(outcomeSlugs))];
    expect(slugs.filter((s) => !known.has(s))).toEqual([]);
    expect(slugs.filter((s) => !inStock.has(s))).toEqual([]);
  });

  it('câu đố dẫn nguồn https ngoài Tubu; câu nhu cầu và bộ dẫn trang sản phẩm Tubu', () => {
    for (const t of byKind('trivia')) {
      const u = new URL(t.sourceUrl);
      expect(`${t.id} ${u.protocol} ${u.hostname.endsWith('tubutree.com')}`).toBe(`${t.id} https: false`);
    }
    for (const i of [...byKind('question'), ...byKind('outcome')]) expect(new URL(i.sourceUrl).hostname).toBe('tubutree.com');
  });

  it('chữ khách thấy qua bộ chặn tuyên bố mức strict (không y tế, không con số chưa nguồn, không "tự nhiên", không tre)', () => {
    const hits = pack.matcher.flatMap((i) => matcherVisibleTexts(i).flatMap((text) => claimsIn(text, 'strict').map((c) => `${i.id}: ${c} "${text}"`)));
    expect(hits).toEqual([]);
  });

  it('bộ kiểm chặn đúng lỗi: mục bật sẵn, lời tuyên bố, slug lạ, câu đố dẫn trang Tubu, nhánh thiếu bộ', () => {
    const bad = clone();
    const trivia = bad.matcher.find((i) => i.kind === 'trivia')!;
    const out = bad.matcher.find((i) => i.kind === 'outcome')!;
    trivia.active = true;
    trivia.explanation = 'Diệt khuẩn tới 99,9% vi khuẩn.';
    trivia.sourceUrl = 'https://tubutree.com/san-pham/abc';
    const payload = out.payload as { slots: { pick: Record<string, string[]> }[] };
    payload.slots[0]!.pick = { any: ['khong-co-trong-catalog'] };
    const errors = validateGameMiniPack(bad).join('\n');
    expect(errors).toMatch(new RegExp(`${trivia.id}: mục Chọn Chuẩn Xanh nạp ở trạng thái tắt`));
    expect(errors).toMatch(new RegExp(`${trivia.id}: cụm cấm`));
    expect(errors).toMatch(new RegExp(`${trivia.id}: lời tuyên bố \\(medical\\)`));
    expect(errors).toMatch(new RegExp(`${trivia.id}: không dùng trang Tubu`));
    expect(errors).toMatch(/khong-co-trong-catalog không có trong ảnh chụp/);

    const gap = clone();
    gap.matcher = gap.matcher.filter((i) => i.id !== 'gm-matcher-o-kitchen-machine');
    expect(validateGameMiniPack(gap).join('\n')).toMatch(/kitchen_how=machine.*không có bộ kết quả khớp/);
  });
});
