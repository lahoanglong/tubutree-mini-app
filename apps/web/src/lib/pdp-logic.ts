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
    return `Rủ đủ ${cfg.targetSize} người, mỗi người nhận mã giảm ${cfg.discountPct}% khi nhóm đủ`;
  }
  return 'Rủ bạn bè cho đủ nhóm, mỗi người nhận mã giảm giá';
}

/** Nhãn ngắn cho mã giảm giá hiển thị ở trang sản phẩm. */
export function couponLabel(c: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount'>): string {
  if (c.type === 'FREESHIP') return 'Miễn phí giao hàng';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%${c.maxDiscount ? ` (tối đa ${formatVnd(c.maxDiscount)})` : ''}`;
  return `Giảm ${formatVnd(c.value)}`;
}

/** /me/coupons đã lọc mã còn hạn và đủ điều kiện; mã gắn riêng cho vài sản phẩm (mã mua chung) chỉ hiện ở đúng sản phẩm đó. */
export function pdpCoupons(coupons: readonly CouponDTO[] | undefined, productId: string): CouponDTO[] {
  return (coupons ?? []).filter((c) => !c.products || c.products.some((x) => x.id === productId));
}

export function freeshipLine(from: number): string {
  return from > 0 ? `Miễn phí giao hàng cho đơn từ ${formatVnd(from)}` : 'Miễn phí giao hàng cho mọi đơn hàng';
}

/**
 * Ngưỡng freeship hứa với khách: khách đăng nhập dùng ngưỡng theo hạng của giỏ (cùng nguồn với giỏ hàng), khách vãng lai dùng ngưỡng
 * chung. Chưa biết chắc (đang tải phiên, giỏ hay config chưa về) thì undefined để không hiện một số rồi đổi.
 */
export function resolveFreeshipFrom(p: {
  phase: AuthPhase;
  cartThreshold: number | undefined;
  configThreshold: number;
  configLoaded: boolean;
}): number | undefined {
  if (p.phase === 'authenticated') return p.cartThreshold;
  if (p.phase === 'loading' || !p.configLoaded) return undefined;
  return p.configThreshold;
}
