import { getStorage, removeStorage, setStorage } from 'zmp-sdk/apis';
import { api } from './api';
import { formatVnd } from '../utils/format';

/** Mã từ thẻ QR trong hộp hàng sàn (link `?claim=`), giữ trên máy tới khi nhận được: khách mở link lúc chưa đăng nhập Zalo. */
export const PENDING_CLAIM_KEY = 'tubu_pending_claim';

const CODE_RE = /^[A-Z0-9_-]{3,64}$/;

export interface ClaimedCoupon {
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: string;
  newCustomerOnly: boolean;
  alreadyClaimed: boolean;
}

/** `?claim=CODE` ở search hoặc hash của URL (Mini App mở từ link zalo.me/s/<Mini App ID>/?claim=...). Mã sai dạng thì bỏ qua. */
export function readClaimParam(...urlParts: string[]): string | null {
  for (const part of urlParts) {
    const query = part.includes('?') ? part.slice(part.indexOf('?') + 1) : part.replace(/^[#?]/, '');
    const raw = new URLSearchParams(query).get('claim');
    const code = raw?.trim().toUpperCase();
    if (code && CODE_RE.test(code)) return code;
  }
  return null;
}

export async function savePendingClaim(code: string): Promise<void> {
  try {
    await setStorage({ data: { [PENDING_CLAIM_KEY]: code } });
  } catch {
    /* Không lưu được thì vẫn nhận trong phiên này; chỉ mất phần "nhận sau khi đăng nhập ở lần mở sau". */
  }
}

export async function readPendingClaim(): Promise<string | null> {
  try {
    const res = await getStorage({ keys: [PENDING_CLAIM_KEY] });
    const raw = (res as Record<string, unknown>)[PENDING_CLAIM_KEY];
    return typeof raw === 'string' && CODE_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function clearPendingClaim(): Promise<void> {
  try {
    await removeStorage({ keys: [PENDING_CLAIM_KEY] });
  } catch {
    /* Mã còn nằm lại thì lần mở sau nhận lại: máy chủ trả "đã có trong ví", không ghi thêm. */
  }
}

export const claimCoupon = (code: string) => api.post<ClaimedCoupon>('/coupons/claim', { code }).then((r) => r.data);

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
