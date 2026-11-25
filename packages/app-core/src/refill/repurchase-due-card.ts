import { fillTemplate } from '../copy-template';
import type { RepurchaseDueItemDTO } from '../api/repurchase-due';

/**
 * Chữ của thẻ "Mua lại" hàng tiêu hao ở Tài khoản và giỏ trống (w36-01). Tách khỏi `shop-copy.ts` và `shop-copy-boot.ts`: chỉ chunk lười của thẻ nạp,
 * không vào gói đầu Mini App hay gói khởi động web.
 */
export const REPURCHASE_DUE_COPY = {
  region: 'Gợi ý mua lại',
  title: 'Đã {days} ngày từ khi bạn nhận {product}',
  refillBody: 'Châm lại bằng {refill}, tiết kiệm hơn và bớt một chai nhựa.',
  sameBody: 'Sắp dùng hết? Đặt thêm {product} trước khi cạn.',
  add: 'Thêm vào giỏ · {price}',
  added: 'Đã thêm',
  viewCart: 'Xem giỏ',
  dismiss: 'Ẩn gợi ý này',
} as const;

export type RepurchaseDueCopyKey = keyof typeof REPURCHASE_DUE_COPY;

/** Số ký tự tối đa sau khi điền giá trị xấu nhất; null = dòng có tên sản phẩm (cắt bằng CSS). Chỉ spec đọc. */
export const REPURCHASE_DUE_COPY_MAX: Record<RepurchaseDueCopyKey, number | null> = {
  region: 20,
  title: null,
  refillBody: null,
  sameBody: null,
  add: 28,
  added: 10,
  viewCart: 10,
  dismiss: 16,
};

export function repurchaseDueCopy(key: RepurchaseDueCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(REPURCHASE_DUE_COPY[key], vars, key);
}

export type RepurchaseDueSurface = 'account' | 'cart_empty';

export interface RepurchaseDueView {
  /** Khoá ẩn 14 ngày (`orderId:variationId`). */
  key: string;
  variationId: string;
  title: string;
  body: string;
  /** Chữ nút duy nhất của thẻ, kèm giá giỏ sẽ tính. */
  cta: string;
}

/** Dựng thẻ từ món máy chủ chọn. `formatPrice` là bộ định dạng tiền của app (Mini và web cùng ra "45.000đ"). */
export function repurchaseDueView(item: RepurchaseDueItemDTO | null | undefined, formatPrice: (n: number) => string): RepurchaseDueView | null {
  if (!item) return null;
  return {
    key: item.key,
    variationId: item.variationId,
    title: repurchaseDueCopy('title', { days: item.days, product: item.boughtName }),
    body: item.kind === 'refill' ? repurchaseDueCopy('refillBody', { refill: item.productName }) : repurchaseDueCopy('sameBody', { product: item.productName }),
    cta: repurchaseDueCopy('add', { price: formatPrice(item.price) }),
  };
}

/** Kho khoá-giá trị kiểu `localStorage` (app truyền vào: app-core không chạm `window`). */
export interface RepurchaseDueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const REPURCHASE_DUE_DISMISS_STORAGE_KEY = 'tubu.repurchase-due.dismissed';
export const REPURCHASE_DUE_DISMISS_MS = 14 * 864e5;
/** Trần số khoá giữ lại: mỗi khoá một lần bấm ×, 14 ngày là hết hạn nên thực tế chỉ vài khoá. */
const DISMISS_MAX_KEYS = 50;

// Dự phòng khi kho không đọc/ghi được (WebView chặn storage, chế độ riêng tư): ẩn vẫn đúng trong phiên.
const memory = new Map<string, number>();

function readStored(store: RepurchaseDueStore | null | undefined): Record<string, number> {
  if (!store) return {};
  try {
    const raw = store.getItem(REPURCHASE_DUE_DISMISS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function dismissedAt(key: string, store: RepurchaseDueStore | null | undefined): number | undefined {
  return memory.get(key) ?? readStored(store)[key];
}

/** Khách đã bấm × cho đúng khoá này trong 14 ngày qua. */
export function isRepurchaseDueDismissed(key: string, now: number, store: RepurchaseDueStore | null | undefined): boolean {
  const at = dismissedAt(key, store);
  return at !== undefined && now - at < REPURCHASE_DUE_DISMISS_MS && at <= now;
}

/** Ẩn khoá này 14 ngày; dọn khoá đã hết hạn và giữ tối đa 50 khoá mới nhất. Ghi lỗi thì vẫn ẩn trong phiên. */
export function dismissRepurchaseDue(key: string, now: number, store: RepurchaseDueStore | null | undefined): void {
  memory.set(key, now);
  if (!store) return;
  try {
    const kept = Object.entries({ ...readStored(store), [key]: now })
      .filter(([, at]) => now - at < REPURCHASE_DUE_DISMISS_MS && at <= now)
      .sort(([, a], [, b]) => b - a)
      .slice(0, DISMISS_MAX_KEYS);
    store.setItem(REPURCHASE_DUE_DISMISS_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Đã nhớ trong phiên ở trên.
  }
}

/** Chỉ spec dùng: xoá bộ nhớ dự phòng giữa các ca. */
export function resetRepurchaseDueMemoryForTest(): void {
  memory.clear();
}
