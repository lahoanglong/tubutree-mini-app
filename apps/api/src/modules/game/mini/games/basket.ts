import { MINI_BASKET_PICK, type MiniProductCard } from '@tubutree/shared-types';
import { SLUG_RE, isRecord, text, type MiniContentRow, type MiniGameDef, type MiniPickCtx } from './game-def';
import { shuffled } from './random';

/**
 * Giỏ Đúng Việc: một đề = một việc (vd "Rửa bình sữa"), 3 sản phẩm đúng + 3 sản phẩm sai kèm lý do. `payload` =
 * { task, correct: [slug×3], wrong: [{ slug, reason }×3] }. Lý do chỉ nói công dụng ghi trên nhãn, không nêu công dụng y tế.
 */
interface BasketPayload {
  task: string;
  correct: string[];
  wrong: { slug: string; reason: string }[];
}

export function readBasketPayload(raw: unknown): BasketPayload | null {
  if (!isRecord(raw)) return null;
  const task = text(raw.task, 160);
  if (!task || !Array.isArray(raw.correct) || !Array.isArray(raw.wrong)) return null;
  if (raw.correct.length !== MINI_BASKET_PICK || raw.wrong.length !== MINI_BASKET_PICK) return null;
  const correct = raw.correct.map((s) => (typeof s === 'string' && SLUG_RE.test(s) ? s : null));
  const wrong = raw.wrong.map((w) => {
    if (!isRecord(w) || typeof w.slug !== 'string' || !SLUG_RE.test(w.slug)) return null;
    const reason = text(w.reason, 160);
    return reason ? { slug: w.slug, reason } : null;
  });
  if (correct.some((s) => s === null) || wrong.some((w) => w === null)) return null;
  const all = [...(correct as string[]), ...wrong.map((w) => w!.slug)];
  if (new Set(all).size !== all.length) return null;
  return { task, correct: correct as string[], wrong: wrong as BasketPayload['wrong'] };
}

function payloadOf(row: MiniContentRow): BasketPayload {
  const p = readBasketPayload(row.payload);
  if (!p) throw new Error(`game_content_items ${row.id}: payload Giỏ Đúng Việc hỏng`);
  return p;
}

const slugsOf = (p: BasketPayload) => [...p.correct, ...p.wrong.map((w) => w.slug)];

/**
 * Đề chỉ được phát khi cả 6 sản phẩm còn bán và còn hàng. Chỉ đòi 3 sản phẩm đúng còn hàng thì thẻ `inStock: false` lúc phát chắc
 * chắn là đáp án sai (lộ đáp án); đòi đủ 6 thì mọi thẻ đều còn hàng và màn kết quả thêm được bộ đúng vào giỏ.
 */
export function basketUsable(row: MiniContentRow, ctx: Pick<MiniPickCtx, 'products'>): boolean {
  const p = readBasketPayload(row.payload);
  if (!p) return false;
  return slugsOf(p).every((s) => ctx.products.get(s)?.inStock === true);
}

export const basketGame: MiniGameDef = {
  game: 'basket',
  payloadError: (payload) =>
    readBasketPayload(payload)
      ? null
      : 'Giỏ Đúng Việc cần { task: chữ 1–160 ký tự, correct: đúng 3 slug sản phẩm, wrong: đúng 3 { slug, reason: chữ 1–160 ký tự } }, 6 slug khác nhau.',
  productSlugs: (row) => {
    const p = readBasketPayload(row.payload);
    return p ? slugsOf(p) : [];
  },
  usable: basketUsable,
  pick(pool, ctx) {
    const usable = pool.filter((r) => basketUsable(r, ctx));
    if (usable.length === 0) return null;
    return [shuffled(usable, ctx.rng)[0]!];
  },
  build(rows, ctx) {
    const row = rows[0]!;
    const p = payloadOf(row);
    const products = shuffled(slugsOf(p), ctx.rng)
      .map((s) => ctx.products.get(s))
      .filter((c): c is MiniProductCard => c !== undefined);
    return { game: 'basket', task: { id: row.id, task: p.task, products } };
  },
  /** Tối đa 3 slug khác nhau, đều nằm trong 6 sản phẩm của đề. */
  parseAnswers(raw, rows) {
    if (rows.length !== 1 || raw.length > MINI_BASKET_PICK) return null;
    const allowed = new Set(slugsOf(payloadOf(rows[0]!)));
    if (!raw.every((s) => typeof s === 'string' && allowed.has(s))) return null;
    if (new Set(raw).size !== raw.length) return null;
    return raw as string[];
  },
  grade(rows, answers) {
    const row = rows[0]!;
    const p = payloadOf(row);
    const picked = answers as string[];
    const correctSet = new Set(p.correct);
    const reasons = new Map(p.wrong.map((w) => [w.slug, w.reason]));
    const picks = picked.map((slug) => ({ slug, correct: correctSet.has(slug), reason: correctSet.has(slug) ? null : (reasons.get(slug) ?? null) }));
    const correct = picks.filter((x) => x.correct).length;
    const allRight = correct === MINI_BASKET_PICK;
    return {
      correct,
      total: MINI_BASKET_PICK,
      correctIds: allRight ? [row.id] : [],
      review: {
        game: 'basket',
        items: [{ contentId: row.id, correct: allRight, correctSlugs: p.correct, picks, explanation: row.explanation, sourceUrl: row.sourceUrl }],
      },
    };
  },
};
