/**
 * Định danh trình duyệt và khoá theo dõi đơn của khách đặt hàng không đăng nhập (cờ `web.guest_checkout_enabled`).
 *
 * - `deviceId` (header `x-guest-device`): chuỗi ngẫu nhiên giữ trong localStorage, máy chủ băm thành tài khoản vãng lai `guest_h_…`. Không phải mật khẩu:
 *   chỉ dùng để gom giỏ/đơn của trình duyệt và để đưa đơn về tài khoản khi khách đăng nhập Zalo ở chính trình duyệt này.
 * - Khoá theo dõi: 32 byte ngẫu nhiên (256 bit) tạo ở trình duyệt, máy chủ chỉ lưu băm. Khoá nằm sau dấu `#` của đường dẫn `/don/<mã>#k=<khoá>`
 *   nên không đi vào log máy chủ hay header Referer.
 */

const DEVICE_KEY = 'tubu.guestCheckout.device';
const ORDERS_KEY = 'tubu.guestCheckout.orders';
const CLAIM_KEY = 'tubu.guestCheckout.claimPending';
/** Giữ khoá của tối đa chừng này đơn gần nhất (đủ cho trần 4 đơn/30 ngày mỗi số). */
const MAX_ORDERS = 20;
/** Đường dẫn theo dõi hết hạn 60 ngày sau khi giao; khoá cũ hơn mốc này chắc chắn không còn dùng. */
const ORDER_KEY_TTL_MS = 180 * 86_400_000;

export const TRACKING_KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{16,128}$/;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

let memoryDevice: string | null = null;

/** deviceId của trình duyệt; chưa có thì tạo. Không ghi được localStorage (chế độ riêng tư chặn) thì dùng một id sống theo tab. */
export function guestDeviceId(): string {
  const s = storage();
  try {
    const saved = s?.getItem(DEVICE_KEY);
    if (saved && DEVICE_RE.test(saved)) return saved;
  } catch {
    /* đọc lỗi thì tạo mới */
  }
  const id = memoryDevice ?? `w_${base64url(randomBytes(24))}`;
  memoryDevice = id;
  try {
    s?.setItem(DEVICE_KEY, id);
  } catch {
    /* giữ trong bộ nhớ tab */
  }
  return id;
}

/** deviceId đã có (không tạo mới): dùng khi đưa đơn về tài khoản. */
export function existingGuestDeviceId(): string | null {
  try {
    const saved = storage()?.getItem(DEVICE_KEY);
    return saved && DEVICE_RE.test(saved) ? saved : memoryDevice;
  } catch {
    return memoryDevice;
  }
}

/** Khoá theo dõi mới cho một lần đặt: 32 byte ngẫu nhiên, base64url không đệm (43 ký tự). */
export function newTrackingKey(): string {
  return base64url(randomBytes(32));
}

type SavedOrders = Record<string, { k: string; at: number }>;

function readOrders(): SavedOrders {
  try {
    const raw = storage()?.getItem(ORDERS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SavedOrders = {};
    for (const [code, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as { k?: unknown; at?: unknown };
      if (typeof e?.k === 'string' && TRACKING_KEY_RE.test(e.k) && typeof e.at === 'number') out[code] = { k: e.k, at: e.at };
    }
    return out;
  } catch {
    return {};
  }
}

/** Nhớ khoá theo dõi cho các mã đơn vừa đặt (đơn tách kiện chung một khoá) và đánh dấu trình duyệt này có đơn chờ đưa về tài khoản. */
export function rememberGuestOrder(codes: readonly string[], key: string, now: number = Date.now()): void {
  const s = storage();
  if (!s) return;
  const orders = readOrders();
  for (const code of codes) orders[code] = { k: key, at: now };
  const kept = Object.entries(orders)
    .filter(([, v]) => now - v.at <= ORDER_KEY_TTL_MS)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_ORDERS);
  try {
    s.setItem(ORDERS_KEY, JSON.stringify(Object.fromEntries(kept)));
    s.setItem(CLAIM_KEY, '1');
  } catch {
    /* hết chỗ: khách vẫn còn đường dẫn trên màn đặt xong */
  }
}

/** Khoá đã lưu của một mã đơn trên trình duyệt này. */
export function savedGuestOrderKey(code: string): string | null {
  return readOrders()[code]?.k ?? null;
}

export function guestClaimPending(): boolean {
  try {
    return storage()?.getItem(CLAIM_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearGuestClaimPending(): void {
  try {
    storage()?.removeItem(CLAIM_KEY);
  } catch {
    /* lần sau gọi lại, máy chủ trả 0 */
  }
}

/** Khoá trong phần `#k=` của địa chỉ trang; sai khuôn thì null. */
export function hashTrackingKey(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const k = params.get('k');
  return k && TRACKING_KEY_RE.test(k) ? k : null;
}

export const guestTrackHref = (code: string, key: string) => `/don/${encodeURIComponent(code)}#k=${key}`;
export const guestBankHref = (code: string, key: string) => `/thanh-toan/chuyen-khoan/${encodeURIComponent(code)}#k=${key}`;
