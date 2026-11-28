// Giỏ của khách chưa đăng nhập trên web (cờ `web.guest_cart_enabled`). Chỉ giữ món và số lượng: giá, tồn kho và tên luôn lấy lại từ API
// công khai lúc hiển thị, nên không có số tiền cũ nào nằm trong máy khách. `slug` để lấy lại chi tiết sản phẩm (API công khai tra theo slug).
//
// localStorage (không phải sessionStorage): khách quay lại hôm sau từ Google vẫn thấy món đã chọn. Mọi đọc/ghi bọc try/catch:
// trình duyệt chặn bộ nhớ hay dữ liệu hỏng thì giỏ coi như trống, trang không vỡ.

import { writeWebCookie } from '../client-api';
import { GUEST_CART_COOKIE, GUEST_CART_ID_RE as ID_RE, GUEST_CART_KEY, GUEST_CART_SLUG_RE as SLUG_RE } from '../guest-prebuilt';

export { GUEST_CART_KEY };
export const GUEST_CART_MAX_LINES = 30;
export const GUEST_CART_MAX_QTY = 99;
const CHANGE_EVENT = 'tubu:guest-cart-change';

export interface GuestCartLine {
  variationId: string;
  slug: string;
  quantity: number;
  addedAt: number;
  /**
   * Số lượng phân loại này trong giỏ máy chủ lúc bắt đầu gộp dòng (đặt ngay trước khi gửi). Lần gộp sau thấy mốc này thì nhắm tới
   * min(tồn, mốc + khách) chứ không cộng thêm lần nữa: lần trước mất mạng sau khi máy chủ đã nhận cũng không thành gấp đôi.
   */
  mergeBase?: { inCart: number; at: number };
}

export type GuestAddResult =
  | { ok: true; added: number; quantity: number }
  | { ok: false; reason: 'full' | 'max' | 'storage' };

const EMPTY: readonly GuestCartLine[] = Object.freeze([]);

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const clampQty = (n: number) => Math.min(GUEST_CART_MAX_QTY, Math.max(1, Math.floor(n)));

function parseMergeBase(v: unknown): GuestCartLine['mergeBase'] | null {
  if (!v || typeof v !== 'object') return null;
  const { inCart, at } = v as Record<string, unknown>;
  if (typeof inCart !== 'number' || !Number.isInteger(inCart) || inCart < 0 || inCart > 9_999) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  return { inCart, at };
}

/** Dòng khách tự đổi số lượng là ý định mới: bỏ mốc gộp cũ. */
function withoutBase({ mergeBase: _drop, ...line }: GuestCartLine): GuestCartLine {
  return line;
}

/** Đọc mảng đã lưu, bỏ dòng sai dạng, gộp dòng trùng phân loại, kẹp số lượng và số dòng về trần. */
export function parseGuestCart(raw: string | null): readonly GuestCartLine[] {
  if (!raw) return EMPTY;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(data)) return EMPTY;
  const byId = new Map<string, GuestCartLine>();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const { variationId, slug, quantity, addedAt } = item as Record<string, unknown>;
    if (typeof variationId !== 'string' || !ID_RE.test(variationId)) continue;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) continue;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 1) continue;
    const at = typeof addedAt === 'number' && Number.isFinite(addedAt) ? addedAt : 0;
    const base = parseMergeBase((item as Record<string, unknown>).mergeBase);
    const prev = byId.get(variationId);
    if (prev) prev.quantity = clampQty(prev.quantity + quantity);
    else if (byId.size < GUEST_CART_MAX_LINES) byId.set(variationId, { variationId, slug, quantity: clampQty(quantity), addedAt: at, ...(base ? { mergeBase: base } : {}) });
  }
  return byId.size === 0 ? EMPTY : Object.freeze([...byId.values()]);
}

// Ảnh chụp cho useSyncExternalStore phải giữ cùng tham chiếu khi chuỗi đã lưu không đổi, kẻo React vẽ lại vô hạn.
let cached: { raw: string | null; lines: readonly GuestCartLine[] } = { raw: null, lines: EMPTY };

// Cookie "giỏ khách có món" cho middleware (lib/guest-prebuilt.ts): có món thì /gio-hang không đi bản dựng sẵn giỏ trống. Ghi lại ở mỗi lần đổi giỏ,
// và một lần mỗi lượt tải trang ở lần đọc đầu (giỏ có từ trước khi có cookie, hoặc cookie hết hạn trước localStorage).
let cookieSynced = false;
function syncCartCookie(hasItems: boolean): void {
  cookieSynced = true;
  writeWebCookie(GUEST_CART_COOKIE, hasItems ? '1' : null);
}

export function readGuestCart(): readonly GuestCartLine[] {
  const s = storage();
  if (!s) return EMPTY;
  let raw: string | null;
  try {
    raw = s.getItem(GUEST_CART_KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cached.raw) cached = { raw, lines: parseGuestCart(raw) };
  if (!cookieSynced) syncCartCookie(cached.lines.length > 0);
  return cached.lines;
}

function write(lines: readonly GuestCartLine[]): boolean {
  const s = storage();
  if (!s) return false;
  try {
    if (lines.length === 0) s.removeItem(GUEST_CART_KEY);
    else s.setItem(GUEST_CART_KEY, JSON.stringify(lines));
  } catch {
    return false;
  }
  syncCartCookie(lines.length > 0);
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* không có window thì không ai nghe */
  }
  return true;
}

/**
 * Thêm món: dòng có sẵn thì cộng dồn. `maxQty` là tồn kho đang hiển thị, kẹp cùng trần 99/dòng; đã chạm trần thì không thêm (`max`).
 * Giỏ đã đủ 30 dòng thì món mới bị từ chối (`full`), món đã có vẫn cộng được.
 */
export function addGuestLine(
  input: { variationId: string; slug: string; quantity: number; maxQty?: number },
  now: number = Date.now(),
): GuestAddResult {
  if (!ID_RE.test(input.variationId) || !SLUG_RE.test(input.slug) || !Number.isFinite(input.quantity) || input.quantity < 1) {
    return { ok: false, reason: 'max' };
  }
  const lines = readGuestCart();
  const cap = Math.min(GUEST_CART_MAX_QTY, Math.floor(input.maxQty ?? GUEST_CART_MAX_QTY));
  const prev = lines.find((l) => l.variationId === input.variationId);
  const have = prev?.quantity ?? 0;
  const quantity = Math.min(cap, have + Math.floor(input.quantity));
  if (quantity <= have) return { ok: false, reason: 'max' };
  if (!prev && lines.length >= GUEST_CART_MAX_LINES) return { ok: false, reason: 'full' };
  const next = prev
    ? lines.map((l) => (l === prev ? { ...withoutBase(l), quantity } : l))
    : [...lines, { variationId: input.variationId, slug: input.slug, quantity, addedAt: now }];
  if (!write(next)) return { ok: false, reason: 'storage' };
  return { ok: true, added: quantity - have, quantity };
}

/**
 * Thêm cả bộ (combo, mua kèm, gợi ý mua kèm) bằng một lần ghi: hoặc vào hết hoặc không món nào, như lệnh lô của giỏ máy chủ.
 * Một sự kiện đổi giỏ duy nhất nên huy hiệu giỏ chỉ vẽ lại một lần. Giỏ không đủ chỗ cho các dòng mới thì `full`; có dòng cộng dồn vượt trần 99 thì `max`
 * (không kẹp xuống 99: bộ thiếu món thì máy chủ không áp giảm giá combo). Dòng sai dạng (mã phân loại hay slug lạ) thì `storage`, để nơi gọi đi lối cũ (sang đăng nhập)
 * thay vì thêm thiếu. Không có tồn kho ở đây: giỏ khách kiểm lại tồn lúc hiển thị, và đặt hàng kiểm lần nữa ở máy chủ.
 * Kết quả: `added` là số đơn vị thêm vào, `quantity` là tổng số món trong giỏ sau khi thêm (một bộ nhiều dòng nên không có "số lượng của dòng").
 */
export function addGuestLines(
  inputs: readonly { variationId: string; slug: string; quantity: number }[],
  now: number = Date.now(),
): GuestAddResult {
  if (inputs.length === 0) return { ok: false, reason: 'max' };
  const lines = readGuestCart();
  const next = new Map(lines.map((l) => [l.variationId, l] as const));
  for (const input of inputs) {
    if (!ID_RE.test(input.variationId) || !SLUG_RE.test(input.slug) || !Number.isFinite(input.quantity) || input.quantity < 1) return { ok: false, reason: 'storage' };
    const prev = next.get(input.variationId);
    const quantity = (prev?.quantity ?? 0) + Math.floor(input.quantity);
    if (quantity > GUEST_CART_MAX_QTY) return { ok: false, reason: 'max' };
    if (!prev && next.size >= GUEST_CART_MAX_LINES) return { ok: false, reason: 'full' };
    next.set(input.variationId, prev ? { ...withoutBase(prev), quantity } : { variationId: input.variationId, slug: input.slug, quantity, addedAt: now });
  }
  const merged = [...next.values()];
  if (!write(merged)) return { ok: false, reason: 'storage' };
  const after = guestCartCount(merged);
  return { ok: true, added: after - guestCartCount(lines), quantity: after };
}

/** Đổi số lượng một dòng (kẹp 1..99; trần tồn kho do nơi gọi kẹp). Dòng không còn thì thôi. */
export function setGuestQuantity(variationId: string, quantity: number): boolean {
  const lines = readGuestCart();
  if (!lines.some((l) => l.variationId === variationId) || !Number.isFinite(quantity)) return false;
  return write(lines.map((l) => (l.variationId === variationId ? { ...withoutBase(l), quantity: clampQty(quantity) } : l)));
}

/** Ghi mốc giỏ máy chủ của một dòng ngay trước khi gửi phần gộp (xem `GuestCartLine.mergeBase`). */
export function markGuestMergeBase(variationId: string, inCart: number, now: number = Date.now()): boolean {
  const lines = readGuestCart();
  if (!lines.some((l) => l.variationId === variationId)) return false;
  return write(lines.map((l) => (l.variationId === variationId ? { ...l, mergeBase: { inCart, at: now } } : l)));
}

export function removeGuestLine(variationId: string): boolean {
  const lines = readGuestCart();
  if (!lines.some((l) => l.variationId === variationId)) return false;
  return write(lines.filter((l) => l.variationId !== variationId));
}

export function clearGuestCart(): void {
  write(EMPTY);
}

export function guestCartCount(lines: readonly GuestCartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** Nghe đổi giỏ trong tab này (sự kiện riêng) và ở tab khác (`storage`). */
export function subscribeGuestCart(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === GUEST_CART_KEY) cb();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

export const EMPTY_GUEST_CART = EMPTY;
