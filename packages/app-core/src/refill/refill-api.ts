import type { HttpClient } from '../http';

/** Gói refill thay cho một chai (cùng dạng `RefillOffer` ở `apps/api/src/modules/catalog/refill/refill-pairs.service.ts`). */
export interface RefillOfferDTO {
  productId: string;
  slug: string;
  name: string;
  thumbnail: string | null;
  /** Phân loại giỏ thêm khi khách đổi. */
  variationId: string;
  /** Giá đang bán trên thẻ (đồng), chưa gồm Giờ vàng. */
  price: number;
  compareAt: number | null;
  /** "10L"; null khi tên không ghi lượng. */
  sizeLabel: string | null;
  inStock: boolean;
  /** Kho Tubu giao. */
  tubu: boolean;
}

/** Id sản phẩm chai → gói refill. Chai không có cặp (hoặc khách chưa từng nhận chai đó) thì vắng. */
export type RefillPairsDTO = Record<string, RefillOfferDTO>;

/** Trần id một lần hỏi, khớp `REFILL_PAIRS_IDS_MAX` của API. */
export const REFILL_PAIRS_IDS_MAX = 50;

/** Id không trùng, xếp ổn định (khoá truy vấn không đổi khi thứ tự dòng giỏ đổi), tối đa `REFILL_PAIRS_IDS_MAX`. */
export function refillQueryIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))].sort().slice(0, REFILL_PAIRS_IDS_MAX);
}

/** Chỉ chai khách đã nhận trong một đơn đã giao (cần đăng nhập). Cờ tắt thì máy chủ trả `{}`. */
export const fetchMyRefillPairs = (http: HttpClient, productIds: readonly string[]) =>
  http.get<RefillPairsDTO>('/catalog/refill-pairs/mine', { query: { ids: productIds.join(',') } });

export const myRefillPairsQuery = (http: HttpClient, productIds: readonly string[]) => ({
  queryKey: ['refill-pairs', 'mine', productIds.join(',')] as const,
  queryFn: () => fetchMyRefillPairs(http, productIds),
  staleTime: 60_000,
  retry: false,
});

const flag = (cfg: object | null | undefined, key: string): boolean => !!cfg && (cfg as Record<string, unknown>)[key] === true;

/** Cờ `catalog.refill_first_enabled` trong cấu hình công khai; API cũ không trả thì tắt (app không gọi endpoint cặp). */
export const refillFirstOn = (cfg: object | null | undefined): boolean => flag(cfg, 'refillFirstEnabled');

/** Cờ `waste.repeat_request_enabled`; API cũ không trả thì tắt. */
export const wasteRepeatOn = (cfg: object | null | undefined): boolean => flag(cfg, 'wasteRepeatRequestEnabled');
