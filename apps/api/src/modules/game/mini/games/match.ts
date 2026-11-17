import { MINI_GAME_RULES, type MiniMatchCard } from '@tubutree/shared-types';
import { isRecord, text, type MiniBuildCtx, type MiniContentRow, type MiniGameDef } from './game-def';
import { shuffled } from './random';

/** Ghép Cặp: `payload` = { ingredient, use }. Máy chủ phát 12 thẻ đã xáo với mã thẻ riêng của ván; khách gửi lại các cặp đã ghép. */
interface MatchPayload {
  ingredient: string;
  use: string;
}

export function readMatchPayload(raw: unknown): MatchPayload | null {
  if (!isRecord(raw)) return null;
  const ingredient = text(raw.ingredient, 60);
  const use = text(raw.use, 80);
  return ingredient && use ? { ingredient, use } : null;
}

function payloadOf(row: MiniContentRow): MatchPayload {
  const p = readMatchPayload(row.payload);
  if (!p) throw new Error(`game_content_items ${row.id}: payload Ghép Cặp hỏng`);
  return p;
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Mã thẻ → (cặp, mặt) của ván; suy lại từ id cặp đã phát. */
function cardIndex(rows: readonly MiniContentRow[], ctx: MiniBuildCtx): Map<string, { contentId: string; side: 'ingredient' | 'use' }> {
  const index = new Map<string, { contentId: string; side: 'ingredient' | 'use' }>();
  for (const r of rows) {
    index.set(ctx.cardId(r.id, 'ingredient'), { contentId: r.id, side: 'ingredient' });
    index.set(ctx.cardId(r.id, 'use'), { contentId: r.id, side: 'use' });
  }
  return index;
}

export const matchGame: MiniGameDef = {
  game: 'match',
  payloadError: (payload) =>
    readMatchPayload(payload) ? null : 'Ghép Cặp cần { ingredient: chữ 1–60 ký tự, use: chữ 1–80 ký tự }.',
  productSlugs: (row) => (row.productSlug ? [row.productSlug] : []),
  usable: (row) => readMatchPayload(row.payload) !== null,
  /** 6 cặp không trùng nhãn nguyên liệu và không trùng nhãn công dụng: hai thẻ cùng chữ thì ghép kiểu nào cũng "đúng" mà máy chủ chấm sai. */
  pick(pool, ctx) {
    const size = MINI_GAME_RULES.match.items;
    const seenIngredient = new Set<string>();
    const seenUse = new Set<string>();
    const picked: MiniContentRow[] = [];
    for (const row of shuffled(pool, ctx.rng)) {
      const p = readMatchPayload(row.payload);
      if (!p || seenIngredient.has(norm(p.ingredient)) || seenUse.has(norm(p.use))) continue;
      seenIngredient.add(norm(p.ingredient));
      seenUse.add(norm(p.use));
      picked.push(row);
      if (picked.length === size) return picked;
    }
    return null;
  },
  build(rows, ctx) {
    const cards: MiniMatchCard[] = rows.flatMap((r) => {
      const p = payloadOf(r);
      return [
        { cardId: ctx.cardId(r.id, 'ingredient'), label: p.ingredient, side: 'ingredient' as const },
        { cardId: ctx.cardId(r.id, 'use'), label: p.use, side: 'use' as const },
      ];
    });
    return { game: 'match', cards: shuffled(cards, ctx.rng) };
  },
  /** Tối đa một cặp mỗi thẻ; thẻ lạ hay một thẻ ghép hai lần là gửi sai dạng (400), không phải trả lời sai. */
  parseAnswers(raw, rows, ctx) {
    if (raw.length > rows.length) return null;
    const index = cardIndex(rows, ctx);
    const used = new Set<string>();
    for (const pair of raw) {
      if (!Array.isArray(pair) || pair.length !== 2) return null;
      for (const card of pair) {
        if (typeof card !== 'string' || !index.has(card) || used.has(card)) return null;
        used.add(card);
      }
    }
    return raw as [string, string][];
  },
  grade(rows, answers, ctx) {
    const index = cardIndex(rows, ctx);
    const matched = new Set<string>();
    for (const [a, b] of answers as [string, string][]) {
      const x = index.get(a)!;
      const y = index.get(b)!;
      if (x.contentId === y.contentId && x.side !== y.side) matched.add(x.contentId);
    }
    const items = rows.map((r) => {
      const p = payloadOf(r);
      return {
        contentId: r.id,
        ingredient: p.ingredient,
        use: p.use,
        correct: matched.has(r.id),
        explanation: r.explanation,
        sourceUrl: r.sourceUrl,
        productSlug: r.productSlug,
      };
    });
    return {
      correct: matched.size,
      total: rows.length,
      correctIds: rows.filter((r) => matched.has(r.id)).map((r) => r.id),
      review: { game: 'match', items },
    };
  },
};
