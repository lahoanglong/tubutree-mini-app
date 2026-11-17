import type { MiniGameId, MiniProductCard, MiniReview, MiniRoundContent } from '@tubutree/shared-types';

/** Một mục nội dung đã nạp (bảng `game_content_items`, hoặc câu `game_quizzes` có nguồn qua bộ chuyển chỉ-đọc). */
export interface MiniContentRow {
  id: string;
  game: MiniGameId;
  payload: unknown;
  explanation: string;
  sourceUrl: string;
  productSlug: string | null;
}

export interface MiniPickCtx {
  rng: () => number;
  /** Ngày VN 'YYYY-MM-DD' của ván. */
  dayKey: string;
  /** Thẻ sản phẩm đang bán (chỉ sản phẩm `isActive`), theo slug. */
  products: ReadonlyMap<string, MiniProductCard>;
}

export interface MiniBuildCtx extends MiniPickCtx {
  /** Mã thẻ Ghép Cặp của ván này. */
  cardId: (contentId: string, side: 'ingredient' | 'use') => string;
  /** Kho Đúng Thùng đang có vật nguy hại: thêm thùng thứ tư. */
  sortHazardous: boolean;
}

export interface MiniGrade {
  correct: number;
  total: number;
  /** Mục làm đúng (con của id đã phát). */
  correctIds: string[];
  review: MiniReview;
}

/**
 * Luật của một game, toàn hàm thuần. `start` gọi `pick` rồi `build` (không lộ đáp án); `submit` gọi `parseAnswers` (sai dạng thì
 * null, máy chủ trả 400) rồi `grade` theo đúng danh sách mục đã phát.
 */
export interface MiniGameDef {
  game: MiniGameId;
  /** Câu lỗi tiếng Việt khi payload sai hình dạng (admin, seed); null khi hợp lệ. */
  payloadError(payload: unknown): string | null;
  /** Slug sản phẩm mục này cần thẻ (gắn sản phẩm, đề Giỏ Đúng Việc). */
  productSlugs(row: MiniContentRow): string[];
  /** Mục còn dùng được để phát (vd đề Giỏ Đúng Việc cần cả 3 sản phẩm đúng còn hàng). */
  usable(row: MiniContentRow, ctx: MiniPickCtx): boolean;
  /** Chọn mục cho một ván; null khi kho không đủ. */
  pick(pool: readonly MiniContentRow[], ctx: MiniPickCtx): MiniContentRow[] | null;
  build(rows: readonly MiniContentRow[], ctx: MiniBuildCtx): MiniRoundContent;
  parseAnswers(raw: readonly unknown[], rows: readonly MiniContentRow[], ctx: MiniBuildCtx): unknown | null;
  grade(rows: readonly MiniContentRow[], answers: unknown, ctx: MiniBuildCtx): MiniGrade;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Chuỗi đã cắt khoảng trắng, dài 1..max; ngoài ra null. */
export function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
