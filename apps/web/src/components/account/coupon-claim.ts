import type { ClaimedCoupon } from '@tubutree/app-core/api/coupon-claim';
import { ApiError, NetworkError } from '@/lib/client-api';
import { formatVnd } from '@/lib/format-vnd';
import { platformBridge } from '@/lib/platform-bridge';

/** Mã từ thẻ QR trong hộp hàng sàn (link `?claim=`), giữ trên máy tới khi nhận được: khách mở link lúc chưa đăng nhập. Cùng khoá với Mini App. */
export const PENDING_CLAIM_KEY = 'tubu_pending_claim';

const CODE_RE = /^[A-Z0-9_-]{3,64}$/;
const RATE_LIMITED_MESSAGE = 'Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.';
const SERVER_BUSY_MESSAGE = 'Máy chủ đang bận, thử lại nhé.';
const GENERIC_MESSAGE = 'Có chút trục trặc, thử lại nhé';

/** `?claim=CODE` ở search hoặc hash của URL. Mã sai dạng thì bỏ qua. */
export function readClaimParam(...urlParts: string[]): string | null {
  for (const part of urlParts) {
    const query = part.includes('?') ? part.slice(part.indexOf('?') + 1) : part.replace(/^[#?]/, '');
    const raw = new URLSearchParams(query).get('claim');
    const code = raw?.trim().toUpperCase();
    if (code && CODE_RE.test(code)) return code;
  }
  return null;
}

/** Đường dẫn (kèm query và hash) không còn tham số `claim`, để thanh địa chỉ không giữ mã đã nhận hoặc đã cất. */
export function withoutClaimParam(href: string): string {
  const url = new URL(href, 'https://x.invalid');
  url.searchParams.delete('claim');
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function savePendingClaim(code: string): Promise<void> {
  try {
    await platformBridge.storage.set(PENDING_CLAIM_KEY, code);
  } catch {
    /* Không lưu được thì vẫn nhận trong phiên này; chỉ mất phần "nhận sau khi đăng nhập ở lần mở sau". */
  }
}

export async function readPendingClaim(): Promise<string | null> {
  try {
    const raw = await platformBridge.storage.get(PENDING_CLAIM_KEY);
    return typeof raw === 'string' && CODE_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Bridge chưa có thao tác xoá nên ghi chuỗi rỗng: `readPendingClaim` coi chuỗi rỗng là không có mã. */
export async function clearPendingClaim(): Promise<void> {
  try {
    await platformBridge.storage.set(PENDING_CLAIM_KEY, '');
  } catch {
    /* Mã còn nằm lại thì lần mở sau nhận lại: máy chủ trả "đã có trong ví", không ghi thêm. */
  }
}

/** "Giảm 30.000đ cho đơn từ 99.000đ", "Giảm 10% (tối đa 50.000đ)", "Miễn phí giao hàng". */
export function claimOfferLabel(c: Pick<ClaimedCoupon, 'type' | 'value' | 'minOrder' | 'maxDiscount'>): string {
  const head =
    c.type === 'FREESHIP'
      ? 'Miễn phí giao hàng'
      : c.type === 'PERCENT'
        ? `Giảm ${c.value}%${c.maxDiscount ? ` (tối đa ${formatVnd(c.maxDiscount)})` : ''}`
        : `Giảm ${formatVnd(c.value)}`;
  return c.minOrder ? `${head} cho đơn từ ${formatVnd(c.minOrder)}` : head;
}

export const needsZaloLogin = (message: string) => /đăng nhập Zalo/i.test(message);

/**
 * Câu báo khách và có nên cho thử lại không. Mã sai, hết hạn, đã có người nhận, khách đã có đơn: máy chủ từ chối thì thử lại cũng
 * vậy (không thử lại). Mất mạng, 5xx, 429: chưa biết kết quả hoặc chỉ tạm thời (cho thử lại, mã vẫn giữ trên máy).
 */
export function claimFailure(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof NetworkError) return { message: err.message, retryable: true };
  if (err instanceof ApiError) {
    if (err.status === 429) return { message: RATE_LIMITED_MESSAGE, retryable: true };
    if (err.status >= 500) return { message: SERVER_BUSY_MESSAGE, retryable: true };
    return { message: err.message, retryable: false };
  }
  return { message: GENERIC_MESSAGE, retryable: false };
}
