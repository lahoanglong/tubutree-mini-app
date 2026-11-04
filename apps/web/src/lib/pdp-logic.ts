import type { ProductFulfiller } from './api';
import type { CouponDTO } from './shop-client';
import type { AuthPhase } from './auth-phase';
import { formatVnd } from './format-vnd';

/**
 * Hàng chỉ bán giá lẻ, không đặt định kỳ và không mua chung: gian hàng tự giao hoặc đang tạm nghỉ/ngừng bán, hay hàng của gian hàng
 * đối tác kể cả khi Tubu giao hộ. Cùng luật với Mini App để không mời khách đặt định kỳ món mà máy chủ sẽ từ chối.
 */
export function isRetailOnly(p: { fulfiller?: ProductFulfiller; partnerOwned?: boolean }): boolean {
  return p.fulfiller?.kind === 'MERCHANT' || p.fulfiller?.kind === 'UNAVAILABLE' || p.partnerOwned === true;
}

/** Đủ người thì mỗi thành viên nhận MÃ GIẢM, không phải giảm thẳng giá; số lấy từ /config/public để copy không nói sai khi admin đổi. */
export function groupBuyPitch(cfg?: { discountPct: number; targetSize: number } | null): string {
  if (cfg && cfg.discountPct > 0 && cfg.targetSize > 0) {
    return `Rủ đủ ${cfg.targetSize} người, mỗi người nhận mã giảm giá ${cfg.discountPct}% khi nhóm đủ`;
  }
  return 'Rủ bạn bè cho đủ nhóm, mỗi người nhận mã giảm giá';
}

// Logic ở app-core (commerce/voucher), dùng chung với Mini App.
export { couponLabel } from '@tubutree/app-core/commerce/voucher';

/** /me/coupons đã lọc mã còn hạn và đủ điều kiện; mã gắn riêng cho vài sản phẩm (mã mua chung) chỉ hiện ở đúng sản phẩm đó. */
export function pdpCoupons(coupons: readonly CouponDTO[] | undefined, productId: string): CouponDTO[] {
  return (coupons ?? []).filter((c) => !c.products || c.products.some((x) => x.id === productId));
}

export function freeshipLine(from: number): string {
  return from > 0 ? `Miễn phí giao hàng cho đơn từ ${formatVnd(from)}` : 'Miễn phí giao hàng cho mọi đơn hàng';
}

/**
 * Ngưỡng freeship hứa với khách: khách đăng nhập dùng ngưỡng theo hạng của giỏ (cùng nguồn với giỏ hàng), khách vãng lai dùng ngưỡng
 * chung. Đang tải phiên thì dùng ngưỡng chung của config (server tải sẵn nên HTML đầu đã có dòng, không chèn thêm sau hydrate); máy có phiên
 * cũ thì `PdpFreeship` giấu chữ đó tới khi biết phiên (`freeshipHiddenWhileRestoring`). Chưa biết chắc (giỏ chưa về, config chưa về) thì undefined để không hiện một số rồi đổi.
 */
export function resolveFreeshipFrom(p: {
  phase: AuthPhase;
  cartThreshold: number | undefined;
  configThreshold: number;
  configLoaded: boolean;
}): number | undefined {
  if (p.phase === 'authenticated') return p.cartThreshold;
  if (!p.configLoaded) return undefined;
  return p.configThreshold;
}

/**
 * Dòng freeship của khách đang khôi phục phiên hoặc đã đăng nhập mà giỏ chưa về: giữ chỗ một dòng nhưng giấu chữ (ngưỡng theo hạng có thể khác ngưỡng chung),
 * để dòng không chèn thêm khi có số thật. `pending` = còn chờ phiên hoặc giỏ.
 */
export function freeshipPlaceholder(p: { phase: AuthPhase; cartThreshold: number | undefined }): boolean {
  return p.phase === 'loading' || (p.phase === 'authenticated' && p.cartThreshold === undefined);
}

/**
 * Hàng "Ưu đãi ›" chỉ hiện khi ví có mã của khách đã đăng nhập: trong lúc khôi phục phiên giữ chỗ 44px (CSS chỉ cho chỗ này hiện khi <html> có
 * `data-restoring`, nên khách chưa từng đăng nhập không mất chỗ nào), để hàng không chèn lên đầu khối ưu đãi khi mã về.
 */
export const OFFERS_SLOT_CLASS = 'hidden h-11 [html[data-restoring]_&]:block';
export function offersSlotNeeded(phase: AuthPhase): boolean {
  return phase === 'loading';
}
