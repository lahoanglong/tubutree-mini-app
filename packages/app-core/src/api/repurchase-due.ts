import type { HttpClient } from '../http';

/** Cùng dạng `RepurchaseDueItem` ở apps/api/src/modules/orders/repurchase-due.service.ts. */
export interface RepurchaseDueItemDTO {
  /** `orderId:variationId`: khoá ẩn thẻ 14 ngày ở máy khách. */
  key: string;
  /** Số ngày lịch VN từ lúc khách nhận đơn. */
  days: number;
  /** Tên sản phẩm khách đã nhận. */
  boughtName: string;
  /** `refill`: gói Refill ghép cặp của chai đã mua; `same`: đúng phân loại đã mua. */
  kind: 'refill' | 'same';
  variationId: string;
  productId: string;
  slug: string;
  productName: string;
  variationName: string;
  thumbnail: string | null;
  /** Giá giỏ sẽ tính cho 1 món (đồng). */
  price: number;
  listPrice: number;
}

/** GET /me/repurchase-due. Cờ `retention.repurchase_due_card_enabled` tắt, không có món hay lỗi đọc: `{ item: null }`. */
export interface RepurchaseDueDTO {
  item: RepurchaseDueItemDTO | null;
}

/** Riêng một gốc khoá: không nằm dưới ['me'] (Vườn Xanh làm mới ['me'] sau mỗi lần tưới, thẻ không đổi theo đó). */
export const REPURCHASE_DUE_KEY = ['repurchase-due'] as const;

const isText = (v: unknown, max = 500): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Body lạ (API cũ chưa có route, route khác trả nhầm) thì không có thẻ, không ném: thẻ chỉ là gợi ý. */
export function parseRepurchaseDue(body: unknown): RepurchaseDueDTO {
  const i = (body as { item?: Partial<RepurchaseDueItemDTO> | null } | null | undefined)?.item;
  if (
    !i ||
    !isText(i.key, 120) ||
    typeof i.days !== 'number' ||
    !Number.isInteger(i.days) ||
    i.days < 1 ||
    !isText(i.boughtName) ||
    (i.kind !== 'refill' && i.kind !== 'same') ||
    !isText(i.variationId, 64) ||
    !isText(i.productId, 64) ||
    !isText(i.slug) ||
    !isText(i.productName) ||
    typeof i.variationName !== 'string' ||
    (i.thumbnail != null && typeof i.thumbnail !== 'string') ||
    !isMoney(i.price) ||
    !isMoney(i.listPrice)
  ) {
    return { item: null };
  }
  return {
    item: {
      key: i.key,
      days: i.days,
      boughtName: i.boughtName,
      kind: i.kind,
      variationId: i.variationId,
      productId: i.productId,
      slug: i.slug,
      productName: i.productName,
      variationName: i.variationName,
      thumbnail: i.thumbnail ?? null,
      price: i.price,
      listPrice: i.listPrice,
    },
  };
}

export const fetchRepurchaseDue = async (http: HttpClient): Promise<RepurchaseDueDTO> => parseRepurchaseDue(await http.get<unknown>('/me/repurchase-due'));

/** Chỉ bật khi đã đăng nhập (nơi gọi đặt `enabled`). Không thử lại: thẻ là gợi ý, lỗi thì không hiện. */
export const repurchaseDueQuery = (http: HttpClient) => ({
  queryKey: REPURCHASE_DUE_KEY,
  queryFn: () => fetchRepurchaseDue(http),
  staleTime: 5 * 60_000,
  retry: false,
});
