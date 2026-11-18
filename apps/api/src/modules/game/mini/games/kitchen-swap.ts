import {
  MINI_GAME_RULES,
  MINI_KITCHEN_CORNERS,
  MINI_KITCHEN_OPTIONS,
  type MiniKitchenCorner,
  type MiniKitchenSwap,
} from '@tubutree/shared-types';
import { SLUG_RE, isRecord, text, type MiniContentRow, type MiniGameDef, type MiniPickCtx } from './game-def';
import { shuffled } from './random';

/**
 * Căn Bếp Xanh: mỗi mục là một món đồ dùng trong một góc nhà (bàn ăn, gian bếp, phòng tắm, túi đi làm) đang giấu vỏ nhựa dùng một lần hay chất
 * tẩy mạnh, kèm 3 sản phẩm Tubu để đổi; đúng một sản phẩm làm đúng việc của món đó theo nhãn. `payload` =
 * { corner, item, emoji?, hidden, options: [{ slug, fact }×3], answer: slug }. `fact` là điều nhãn của chính sản phẩm (loại hàng, quy cách,
 * thành phần in trên bao bì), cùng một chữ ở mọi món có sản phẩm đó (seed chặn), không nói sản phẩm hợp hay không hợp với món: cả 3 điều nhãn đi
 * trong nội dung ván lúc bắt đầu nên không được lộ đáp án. Cách dùng hợp với món (rót lại, chiết ra lọ nhỏ) để ở `explanation`, chỉ trả sau khi chấm.
 */
export interface KitchenSwapPayload {
  corner: MiniKitchenCorner;
  item: string;
  emoji: string | null;
  hidden: string;
  options: { slug: string; fact: string }[];
  answer: string;
}

export const KITCHEN_ITEM_MAX = 80;
export const KITCHEN_HIDDEN_MAX = 140;
export const KITCHEN_FACT_MAX = 140;
const EMOJI_MAX = 8;

const isCorner = (v: unknown): v is MiniKitchenCorner => typeof v === 'string' && (MINI_KITCHEN_CORNERS as readonly string[]).includes(v);

export function readKitchenSwapPayload(raw: unknown): KitchenSwapPayload | null {
  if (!isRecord(raw) || !isCorner(raw.corner)) return null;
  const item = text(raw.item, KITCHEN_ITEM_MAX);
  const hidden = text(raw.hidden, KITCHEN_HIDDEN_MAX);
  if (!item || !hidden) return null;
  let emoji: string | null = null;
  if (raw.emoji !== undefined && raw.emoji !== null) {
    emoji = text(raw.emoji, EMOJI_MAX);
    if (!emoji) return null;
  }
  if (!Array.isArray(raw.options) || raw.options.length !== MINI_KITCHEN_OPTIONS) return null;
  const options = raw.options.map((o) => {
    if (!isRecord(o) || typeof o.slug !== 'string' || !SLUG_RE.test(o.slug)) return null;
    const fact = text(o.fact, KITCHEN_FACT_MAX);
    return fact ? { slug: o.slug, fact } : null;
  });
  if (options.some((o) => o === null)) return null;
  const slugs = options.map((o) => o!.slug);
  if (new Set(slugs).size !== slugs.length) return null;
  if (typeof raw.answer !== 'string' || !slugs.includes(raw.answer)) return null;
  return { corner: raw.corner, item, emoji, hidden, options: options as KitchenSwapPayload['options'], answer: raw.answer };
}

function payloadOf(row: MiniContentRow): KitchenSwapPayload {
  const p = readKitchenSwapPayload(row.payload);
  if (!p) throw new Error(`game_content_items ${row.id}: payload Căn Bếp Xanh hỏng`);
  return p;
}

/**
 * Món chỉ được phát khi cả 3 sản phẩm còn bán và còn hàng: thẻ hết hàng lúc phát gần như chắc chắn là đáp án sai (lộ đáp án), và màn kết quả cần
 * sản phẩm đúng còn hàng để thêm vào giỏ dùng thử.
 */
export function kitchenSwapUsable(row: MiniContentRow, ctx: Pick<MiniPickCtx, 'products'>): boolean {
  const p = readKitchenSwapPayload(row.payload);
  if (!p) return false;
  return p.options.every((o) => ctx.products.get(o.slug)?.inStock === true);
}

const ROUND_SIZE = MINI_GAME_RULES.kitchen_swap.items;

/** Đủ để phát một ván: các mục dùng được trải trên ít nhất `ROUND_SIZE` góc nhà khác nhau. */
export function kitchenSwapReady(rows: readonly MiniContentRow[], ctx: Pick<MiniPickCtx, 'products'>): boolean {
  const corners = new Set(rows.filter((r) => kitchenSwapUsable(r, ctx)).map((r) => payloadOf(r).corner));
  return corners.size >= ROUND_SIZE;
}

export const kitchenSwapGame: MiniGameDef = {
  game: 'kitchen_swap',
  payloadError: (payload) =>
    readKitchenSwapPayload(payload)
      ? null
      : `Căn Bếp Xanh cần { corner: ${MINI_KITCHEN_CORNERS.join('/')}, item: chữ 1–${KITCHEN_ITEM_MAX} ký tự, emoji?: 1–${EMOJI_MAX} ký tự, hidden: chữ 1–${KITCHEN_HIDDEN_MAX} ký tự, options: đúng ${MINI_KITCHEN_OPTIONS} { slug, fact: chữ 1–${KITCHEN_FACT_MAX} ký tự } khác slug nhau, answer: một slug trong options }.`,
  productSlugs: (row) => readKitchenSwapPayload(row.payload)?.options.map((o) => o.slug) ?? [],
  usable: kitchenSwapUsable,
  /** Một món mỗi góc, `ROUND_SIZE` góc khác nhau chọn ngẫu nhiên; ván đi theo thứ tự góc cố định (bàn ăn, gian bếp, phòng tắm, túi đi làm). */
  pick(pool, ctx) {
    const byCorner = new Map<MiniKitchenCorner, MiniContentRow[]>();
    for (const row of pool) {
      if (!kitchenSwapUsable(row, ctx)) continue;
      const corner = payloadOf(row).corner;
      byCorner.set(corner, [...(byCorner.get(corner) ?? []), row]);
    }
    if (byCorner.size < ROUND_SIZE) return null;
    const corners = new Set(shuffled([...byCorner.keys()], ctx.rng).slice(0, ROUND_SIZE));
    return MINI_KITCHEN_CORNERS.filter((c) => corners.has(c)).map((c) => shuffled(byCorner.get(c)!, ctx.rng)[0]!);
  },
  build(rows, ctx) {
    const swaps: MiniKitchenSwap[] = rows.map((row) => {
      const p = payloadOf(row);
      const options = shuffled(p.options, ctx.rng).flatMap((o) => {
        const product = ctx.products.get(o.slug);
        return product ? [{ product, fact: o.fact }] : [];
      });
      return { id: row.id, corner: p.corner, item: p.item, emoji: p.emoji, hidden: p.hidden, options };
    });
    return { game: 'kitchen_swap', swaps };
  },
  /** Mỗi món một phần tử: slug thuộc 3 sản phẩm của món đó, hoặc null (hết giờ chưa đổi). */
  parseAnswers(raw, rows) {
    if (raw.length !== rows.length) return null;
    const out: (string | null)[] = [];
    for (const [i, row] of rows.entries()) {
      const given = raw[i];
      if (given === null) {
        out.push(null);
        continue;
      }
      if (typeof given !== 'string' || !payloadOf(row).options.some((o) => o.slug === given)) return null;
      out.push(given);
    }
    return out;
  },
  grade(rows, answers) {
    const given = answers as (string | null)[];
    const items = rows.map((row, i) => {
      const p = payloadOf(row);
      const pick = given[i] ?? null;
      return {
        contentId: row.id,
        correct: pick === p.answer,
        corner: p.corner,
        item: p.item,
        given: pick,
        expected: p.answer,
        explanation: row.explanation,
        sourceUrl: row.sourceUrl,
      };
    });
    return {
      correct: items.filter((x) => x.correct).length,
      total: rows.length,
      correctIds: items.filter((x) => x.correct).map((x) => x.contentId),
      review: { game: 'kitchen_swap', items },
    };
  },
};
