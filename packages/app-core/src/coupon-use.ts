import type { CouponPreviewDTO } from '@tubutree/shared-types';
import { vndShort } from './commerce/money';
import { fillCopy } from './shop-copy';

/** Chữ và điểm đến của nút "Sao chép" / "Dùng ngay" trên thẻ mã giảm giá (Mini App và web dùng chung). */
export const couponUseCopy = {
  copy: 'Sao chép',
  copyAria: (code: string) => `Sao chép mã ${code}`,
  copied: 'Đã sao chép mã',
  copyFailed: 'Không sao chép được, hãy đọc mã khi thanh toán',
  use: 'Dùng ngay',
  useAria: (code: string) => `Dùng mã ${code} ngay`,
  /** Mã đã chọn sẵn ở giỏ nhưng chưa dùng được cho giỏ này (đơn tối thiểu, phạm vi sản phẩm): nói lý do của máy chủ, không im lặng. */
  notApplied: (reason: string) => `Chưa chọn sẵn được mã: ${reason}`,
  /** Giỏ đang giữ mã khác: nói rõ mã cũ đã bị thay để khách không ngạc nhiên ở bước thanh toán. */
  switched: (code: string) => `Đã đổi sang mã ${code}`,
} as const;

export type CouponUseTarget = 'cart' | 'products';

/** Dòng gợi ý ở giỏ/thanh toán khi giỏ chưa có mã: không tự áp, chỉ cho khách biết đang có mã dùng được. */
export interface CouponHint {
  count: number;
  /** Mức tiết kiệm lớn nhất của một mã dùng được (giảm tiền hàng + phí giao được miễn); 0 khi chưa biết phí giao (giỏ chưa chọn địa chỉ). */
  maxSaving: number;
}

/** Từ kết quả xem trước từng mã của máy chủ (`/checkout/coupon-previews`); null khi chưa có số hoặc không mã nào dùng được. */
export function couponHint(previews: readonly CouponPreviewDTO[] | null | undefined): CouponHint | null {
  const usable = (previews ?? []).filter((p) => p.eligible);
  if (usable.length === 0) return null;
  const saving = (p: CouponPreviewDTO) => Math.max(0, p.discount || 0) + Math.max(0, p.freeshipSaving ?? 0);
  return { count: usable.length, maxSaving: Math.max(...usable.map(saving)) };
}

/** Giỏ chưa chọn địa chỉ thì mã freeship chưa có số tiền: nói số mã thôi, không hứa "giảm đến 0đ". */
export function couponHintText(hint: CouponHint, formatMoney: (n: number) => string): string {
  const base = `Bạn có ${hint.count} mã dùng được`;
  return hint.maxSaving > 0 ? `${base} · giảm đến ${formatMoney(hint.maxSaving)}` : base;
}

/**
 * Bản ngắn của `couponHintText` cho dòng một hàng ở chân dính giỏ (Mini App và web), nơi "Bạn có 6 mã dùng được · giảm đến 60.000đ" bị
 * cắt "…" ở 375px. Số tiền luôn rút gọn xuống tròn nghìn (tới 1 triệu) hay tròn trăm nghìn (từ 1 triệu): "giảm đến" chỉ được nói thấp hơn
 * mức giảm thật, không bao giờ cao hơn, và chữ không còn phụ thuộc số lẻ (123.456đ → 123k) nên một dòng ở 375px dù mã giảm bao nhiêu.
 * Câu đầy đủ với số tiền chính xác vẫn dùng ở thanh toán và khung mở rộng (`couponHintText`).
 */
export function couponHintShort(hint: CouponHint): string {
  if (!(hint.maxSaving > 0)) return fillCopy('coupon.hintShortPlain', { n: hint.count });
  const unit = hint.maxSaving >= 1_000_000 ? 100_000 : 1_000;
  const floored = Math.floor(hint.maxSaving / unit) * unit;
  // Dưới 1.000đ không có dạng k: ghi đủ (vndShort trả lại "950đ").
  return fillCopy('coupon.hintShort', { n: hint.count, x: vndShort(floored > 0 ? floored : hint.maxSaving) });
}

/** Giỏ có hàng thì tới giỏ (chọn sẵn mã ở đó), chưa có thì tới danh sách sản phẩm để mua. */
export function couponUseTarget(cartItemCount: number): CouponUseTarget {
  return cartItemCount > 0 ? 'cart' : 'products';
}

export type CouponUseOutcome = { kind: 'ok' } | { kind: 'switched'; text: string } | { kind: 'notApplied'; text: string };

/**
 * Kết quả sau khi áp mã vào giỏ bằng "Dùng ngay". `previous` là mã giỏ đang giữ TRƯỚC khi áp. Máy chủ giữ mã nhưng chưa
 * tính giảm (đơn tối thiểu, phạm vi sản phẩm) thì nói lý do; mã khác với mã cũ thì báo đã đổi.
 */
export function couponUseOutcome(
  previous: string | null | undefined,
  code: string,
  cart: { couponCode: string | null; discount: number; freeship?: boolean; couponNotice?: string | null },
): CouponUseOutcome {
  if (cart.couponNotice && cart.discount === 0 && !cart.freeship) return { kind: 'notApplied', text: couponUseCopy.notApplied(cart.couponNotice) };
  const now = (cart.couponCode ?? code).toUpperCase();
  if (previous && previous.toUpperCase() !== now) return { kind: 'switched', text: couponUseCopy.switched(now) };
  return { kind: 'ok' };
}

/** Chữ của dòng mã giảm giá khi thanh toán tự áp mã cho khách (Mini App và web dùng chung). */
export const couponAutoCopy = {
  applied: 'Đã tự áp',
  remove: 'Gỡ',
  removeAria: (code: string) => `Gỡ mã ${code} đã tự áp`,
} as const;

/**
 * Mã tự áp ở thanh toán: mã dùng được có mức tiết kiệm (giảm tiền hàng + phí giao được miễn) lớn nhất theo xem trước của máy chủ.
 * Hoà thì mã hết hạn sớm hơn (`endAt` trong ví; không biết hạn thì xếp sau), vẫn hoà thì theo mã cho kết quả ổn định.
 * Trả null khi không mã nào giảm được.
 */
export function pickBestCoupon(
  previews: readonly CouponPreviewDTO[] | null | undefined,
  wallet: readonly { code: string; endAt?: string | null }[] | null | undefined,
): string | null {
  const expiry = new Map((wallet ?? []).map((c) => [c.code.toUpperCase(), c.endAt ? Date.parse(c.endAt) : Infinity]));
  const saving = (p: CouponPreviewDTO) => Math.max(0, p.discount || 0) + Math.max(0, p.freeshipSaving ?? 0);
  const endsAt = (p: CouponPreviewDTO) => {
    const t = expiry.get(p.code.toUpperCase());
    return t == null || Number.isNaN(t) ? Infinity : t;
  };
  const candidates = (previews ?? []).filter((p) => p.eligible && saving(p) > 0);
  candidates.sort((a, b) => saving(b) - saving(a) || endsAt(a) - endsAt(b) || a.code.localeCompare(b.code));
  return candidates[0]?.code ?? null;
}

type MemoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Trí nhớ theo phiên (sessionStorage) của mã tự áp ở thanh toán, khoá theo khách: tải lại trang hay đi sang màn khác rồi
 * quay lại vẫn nhớ khách đã gỡ mã (không áp lại) và mã nào đang nằm trên giỏ là mã đã tự áp (còn nhãn "Đã tự áp").
 * Mọi thao tác nuốt lỗi: trình duyệt chặn lưu trữ thì chỉ mất trí nhớ, không hỏng màn.
 */
export function autoCouponMemory(storage: MemoryStorage | null | undefined, userId: string | null | undefined) {
  const uid = userId ?? '';
  const appliedKey = `tubu.autocoupon.applied:${uid}`;
  const offKey = `tubu.autocoupon.off:${uid}`;
  const read = (k: string) => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const write = (k: string, v: string | null) => {
    try {
      if (v == null) storage?.removeItem(k);
      else storage?.setItem(k, v);
    } catch {
      /* không lưu được thì thôi */
    }
  };
  return {
    /** Mã đã được tự áp (viết hoa) và chưa bị khách đổi/gỡ. */
    applied: () => read(appliedKey),
    /** Khách đã gỡ hoặc đổi mã tự áp: không tự áp nữa trong phiên này. */
    off: () => read(offKey) === '1',
    markApplied: (code: string) => write(appliedKey, code.toUpperCase()),
    /** Khách gỡ hoặc đổi mã: quên mã đã tự áp và không tự áp lại. */
    markOff: () => {
      write(appliedKey, null);
      write(offKey, '1');
    },
    /** Đặt đơn xong: lượt thanh toán sau bắt đầu lại từ đầu. */
    clear: () => {
      write(appliedKey, null);
      write(offKey, null);
    },
  };
}
