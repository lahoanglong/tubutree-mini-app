'use client';

import type { PdpAction } from '@tubutree/shared-types';
import { trackPurchase } from '@/lib/analytics';

const SHELF_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const MAX_POSITION = 500;
const MAX_AGE_DAYS = 3650;
const DAY_MS = 86_400_000;

/** `product_card_click`: máy chủ bỏ cả sự kiện khi một trường sai khuôn (vd. vị trí > 500 ở danh sách cuộn dài), nên lọc trước khi gửi. */
export function trackCardClick(shelf: string, position: number, productSlug: string): void {
  if (!SHELF_RE.test(shelf) || !Number.isInteger(position) || position < 1 || position > MAX_POSITION || !SLUG_RE.test(productSlug)) return;
  trackPurchase('product_card_click', { shelf, position, productSlug });
}

export function trackPdpAction(action: PdpAction, productSlug: string): void {
  trackPurchase('pdp_action', { action, productSlug });
}

/** Số ngày tròn (0..3650) từ mốc của đơn tới lúc gọi; mốc thiếu hay hỏng thì null để nơi gọi bỏ sự kiện thay vì gửi số bịa. */
export function orderAgeDays(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.min(MAX_AGE_DAYS, Math.max(0, Math.floor((now - at) / DAY_MS)));
}
