import { CART_BATCH_REJECTED, type MiniProductCard } from '@tubutree/shared-types';
import { fetchProductsBySlugs, type ProductCard } from '../api/catalog';
import { errorCode } from '../api/error-status';
import type { HttpClient } from '../http';
import { gameCopy } from './copy';

/**
 * "Thêm bộ này vào giỏ" của Giỏ Đúng Việc: thêm 3 món đúng, mỗi món 1, qua `POST /cart/items/batch` sẵn có. Thẻ sản phẩm của nội dung game chỉ có
 * slug nên tải thẻ hiện hành (`GET /products?slugs=`) để lấy phân loại đại diện (`repVariationId`: phân loại rẻ nhất còn hàng, cùng phân loại trang
 * chi tiết mở sẵn) và tồn kho mới nhất.
 *
 * Lệnh batch là tất cả-hoặc-không: một món hết hàng thì cả lô bị từ chối. Lời từ chối của web không mang mã phân loại, nên khi bị từ chối thì thêm
 * lại từng món một để biết chính xác món nào hỏng, món còn lại vẫn vào giỏ. Không gửi `addSource` (API chưa có nguồn "game"; gửi nguồn khác là ghi
 * sai). Không có lời gọi thưởng nào ở đây: game này không thưởng khi thêm giỏ hay khi mua.
 */

/**
 * Bộ đúng chờ thêm giỏ khi khách web chưa đăng nhập: kết quả ván chỉ nằm trong bộ nhớ trang, nên trước khi sang đăng nhập bộ đúng được ghi vào
 * `sessionStorage`; quay về màn Giỏ Đúng Việc trong `BASKET_PENDING_TTL_MS` thì bộ hiện lại để khách bấm thêm (không tự thêm khi khách chưa bấm).
 */
export const BASKET_PENDING_KEY = 'tubu.mini.basketPending.v1';
export const BASKET_PENDING_TTL_MS = 30 * 60_000;
const BASKET_PENDING_MAX = 6;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/;
const IMAGE_RE = /^(https?:\/\/|\/)/;

export function encodeBasketPending(products: readonly MiniProductCard[], now: number = Date.now()): string {
  return JSON.stringify({
    at: now,
    products: products.slice(0, BASKET_PENDING_MAX).map(({ slug, name, imageUrl, price, inStock }) => ({ slug, name, imageUrl, price, inStock })),
  });
}

/** Đọc bộ chờ; quá hạn, hỏng hay sai dạng thì null (không tin dữ liệu trong trình duyệt). */
export function decodeBasketPending(raw: string | null, now: number = Date.now()): MiniProductCard[] | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const { at, products } = v as { at?: unknown; products?: unknown };
  if (typeof at !== 'number' || at > now || now - at > BASKET_PENDING_TTL_MS) return null;
  if (!Array.isArray(products) || products.length === 0 || products.length > BASKET_PENDING_MAX) return null;
  const out: MiniProductCard[] = [];
  for (const p of products as unknown[]) {
    if (!p || typeof p !== 'object') return null;
    const { slug, name, imageUrl, price, inStock } = p as Record<string, unknown>;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) return null;
    if (imageUrl !== null && (typeof imageUrl !== 'string' || !IMAGE_RE.test(imageUrl))) return null;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return null;
    if (typeof inStock !== 'boolean') return null;
    out.push({ slug, name, imageUrl, price, inStock });
  }
  return out;
}

export interface BasketCartLine {
  slug: string;
  name: string;
  variationId: string;
}

export interface BasketCartPlan {
  lines: BasketCartLine[];
  /** Tên các món không thêm được (hết hàng, ngừng bán, chưa có phân loại). */
  skipped: string[];
}

/** Món nào thêm được: thẻ hiện hành còn hàng và có phân loại đại diện. Thẻ không về (đã ẩn, ngừng bán) cũng là bỏ qua. */
export function basketCartPlan(products: readonly MiniProductCard[], cards: readonly ProductCard[]): BasketCartPlan {
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  const lines: BasketCartLine[] = [];
  const skipped: string[] = [];
  for (const p of products) {
    const card = bySlug.get(p.slug);
    if (card && card.inStock && card.repVariationId) lines.push({ slug: p.slug, name: p.name, variationId: card.repVariationId });
    else skipped.push(p.name);
  }
  return { lines, skipped };
}

export interface BasketCartResult {
  added: string[];
  skipped: string[];
  /** Lỗi không phải "hết hàng" (mạng, máy chủ) làm dừng giữa chừng: các món `added` đã vào giỏ, các món này chưa gửi được. */
  unsent: string[];
}

const postBatch = (http: HttpClient, lines: readonly BasketCartLine[], storefrontSlug: string | null | undefined) =>
  http.post<unknown>('/cart/items/batch', { items: lines.map((l) => ({ variationId: l.variationId, quantity: 1 })) }, storefrontSlug ? { query: { storefrontSlug } } : undefined);

export const isBatchRejected = (err: unknown) => errorCode(err) === CART_BATCH_REJECTED;

/** Câu báo sau khi thêm: món đã vào, món hết hàng (nêu tên), món chưa gửi được vì mạng. */
export function basketCartLines(r: BasketCartResult): string[] {
  const lines: string[] = [];
  if (r.added.length > 0) lines.push(gameCopy('basket.added', { n: r.added.length }));
  if (r.skipped.length > 0) lines.push(gameCopy(r.added.length > 0 || r.unsent.length > 0 ? 'basket.skipped' : 'basket.none', { names: r.skipped.join(', ') }));
  if (r.unsent.length > 0) lines.push(gameCopy('basket.unsent', { names: r.unsent.join(', ') }));
  return lines;
}

/**
 * Thêm bộ đúng vào giỏ. Ném lỗi khi lệnh đầu tiên hỏng không vì hết hàng (chưa món nào vào giỏ): nơi gọi báo "thử lại". Lỗi khác giữa lúc thêm
 * từng món thì trả các món đã vào cùng các món chưa gửi (`unsent`); nơi gọi không gửi lại cả bộ, kẻo món đã vào giỏ bị cộng thêm lần nữa.
 */
export async function addBasketToCart(http: HttpClient, products: readonly MiniProductCard[], storefrontSlug?: string | null): Promise<BasketCartResult> {
  const cards = await fetchProductsBySlugs(http, products.map((p) => p.slug));
  const { lines, skipped } = basketCartPlan(products, cards);
  if (lines.length === 0) return { added: [], skipped, unsent: [] };
  try {
    await postBatch(http, lines, storefrontSlug);
    return { added: lines.map((l) => l.name), skipped, unsent: [] };
  } catch (err) {
    if (!isBatchRejected(err)) throw err;
  }
  const added: string[] = [];
  const rest = [...skipped];
  for (const [i, line] of lines.entries()) {
    try {
      await postBatch(http, [line], storefrontSlug);
      added.push(line.name);
    } catch (err) {
      if (!isBatchRejected(err)) return { added, skipped: rest, unsent: lines.slice(i).map((l) => l.name) };
      rest.push(line.name);
    }
  }
  return { added, skipped: rest, unsent: [] };
}
