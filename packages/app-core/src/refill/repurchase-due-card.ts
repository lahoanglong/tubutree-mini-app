import { fillTemplate } from '../copy-template';
import type { RepurchaseDueItemDTO } from '../api/repurchase-due';
import { refillLandingRows, type RefillLandingDTO } from './refill-landing';

/**
 * Chữ của thẻ "Mua lại" hàng tiêu hao ở Tài khoản, giỏ trống và trang Tiết kiệm với Refill (w36-01, w55-01). Tách khỏi `shop-copy.ts` và `shop-copy-boot.ts`:
 * chỉ chunk lười của thẻ nạp, không vào gói đầu Mini App hay gói khởi động web. Nhóm `smart*` (w55-01) là chữ "Sắp hết hàng? Đặt lại 1 chạm" của giỏ trống và
 * trang Refill: tiêu đề cố định, thân một đến hai dòng nêu món và số ngày; Tài khoản giữ chữ w36-01.
 */
export const REPURCHASE_DUE_COPY = {
  region: 'Gợi ý mua lại',
  title: 'Đã {days} ngày từ khi bạn nhận {product}',
  refillBody: 'Châm lại bằng {refill}, tiết kiệm hơn và bớt một chai nhựa.',
  sameBody: 'Sắp dùng hết? Đặt thêm {product} trước khi cạn.',
  smartTitle: 'Sắp hết hàng? Đặt lại 1 chạm',
  smartRefill: '{bought} đã {days} ngày. Châm lại bằng {refill}.',
  smartSame: '{product} đã {days} ngày, sắp dùng hết.',
  smartScan: 'Đơn sàn của bạn giao {days} ngày trước. Châm lại bằng {refill}.',
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
  smartTitle: 30,
  smartRefill: null,
  smartSame: null,
  smartScan: null,
  add: 28,
  added: 10,
  viewCart: 10,
  dismiss: 16,
};

export function repurchaseDueCopy(key: RepurchaseDueCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(REPURCHASE_DUE_COPY[key], vars, key);
}

export type RepurchaseDueSurface = 'account' | 'cart_empty' | 'refill_landing';

/** Nơi nói "Sắp hết hàng? Đặt lại 1 chạm" (w55-01); Tài khoản giữ chữ w36-01. */
const SMART_SURFACES: readonly RepurchaseDueSurface[] = ['cart_empty', 'refill_landing'];
/**
 * Nơi nhận món ghép theo mốc đơn sàn (đơn sàn không có dòng sản phẩm): chỉ giỏ trống. Trang Refill đã liệt kê đúng các gói đó ngay dưới nên thẻ sẽ lặp một
 * hàng; Tài khoản không có chữ nào hợp với một món không rõ chai.
 */
const SCAN_SURFACES: readonly RepurchaseDueSurface[] = ['cart_empty'];

export interface RepurchaseDueView {
  /** Khoá ẩn 14 ngày (`orderId:variationId`; món ghép theo đơn sàn: `scan:variationId`). */
  key: string;
  variationId: string;
  title: string;
  body: string;
  /** Chữ nút duy nhất của thẻ, kèm giá giỏ sẽ tính. */
  cta: string;
  /** `order`: món theo đơn trực tiếp máy chủ chọn; `scan`: gói Refill đầu trang Tiết kiệm ghép theo mốc đơn sàn. */
  source: 'order' | 'scan';
}

export interface RepurchaseDueViewOptions {
  surface?: RepurchaseDueSurface;
  /** Mốc đơn sàn đã quét (`RepurchaseDueDTO.scanDays`); chỉ dùng khi không có món theo đơn trực tiếp. */
  scanDays?: number | null;
  /** Trang Tiết kiệm với Refill (công khai, cùng khoá truy vấn với trang); chưa tải hay cờ tắt thì không ghép được. */
  landing?: RefillLandingDTO | null;
}

/**
 * Dựng thẻ từ món máy chủ chọn; không có món mà có mốc đơn sàn (giỏ trống) thì ghép gói Refill đầu danh sách trang Refill (còn hàng, rẻ hơn nhiều nhất trước).
 * `formatPrice` là bộ định dạng tiền của app (Mini và web cùng ra "45.000đ").
 */
export function repurchaseDueView(
  item: RepurchaseDueItemDTO | null | undefined,
  formatPrice: (n: number) => string,
  opts: RepurchaseDueViewOptions = {},
): RepurchaseDueView | null {
  const smart = opts.surface !== undefined && SMART_SURFACES.includes(opts.surface);
  if (item) {
    const days = item.days;
    const body = smart
      ? item.kind === 'refill'
        ? repurchaseDueCopy('smartRefill', { bought: item.boughtName, days, refill: item.productName })
        : repurchaseDueCopy('smartSame', { product: item.productName, days })
      : item.kind === 'refill'
        ? repurchaseDueCopy('refillBody', { refill: item.productName })
        : repurchaseDueCopy('sameBody', { product: item.productName });
    return {
      key: item.key,
      variationId: item.variationId,
      title: smart ? repurchaseDueCopy('smartTitle') : repurchaseDueCopy('title', { days, product: item.boughtName }),
      body,
      cta: repurchaseDueCopy('add', { price: formatPrice(item.price) }),
      source: 'order',
    };
  }
  if (typeof opts.scanDays === 'number' && opts.scanDays >= 1 && opts.surface !== undefined && SCAN_SURFACES.includes(opts.surface)) {
    const row = refillLandingRows(opts.landing)[0];
    if (!row) return null;
    return {
      key: `scan:${row.view.variationId}`,
      variationId: row.view.variationId,
      title: repurchaseDueCopy('smartTitle'),
      body: repurchaseDueCopy('smartScan', { days: opts.scanDays, refill: row.view.name }),
      cta: repurchaseDueCopy('add', { price: formatPrice(row.view.price) }),
      source: 'scan',
    };
  }
  return null;
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
