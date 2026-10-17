'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Ticket, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyCoupon,
  formatVnd,
  getCouponPreviews,
  getMyCoupons,
  removeCoupon,
  type CouponPreviewParams,
} from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import {
  couponExpiryLabel,
  couponValueLabel,
  isCouponEligible,
  isFreeshipRedundant,
  sortCouponsForCart,
} from '@/lib/coupon-view';
import { autoCouponName } from '@/lib/coupon-name';
import { cartKey } from '@/lib/cart-key';

/** Số voucher hiện sẵn; còn lại nằm sau nút xem thêm để giỏ/thanh toán trên điện thoại không dài thêm hàng chục cuộn. */
const VISIBLE_COUPONS = 3;

/** Chờ lựa chọn/số lượng đứng yên rồi mới hỏi lại mức giảm, để bấm liên tục không chạm giới hạn 30 lần/phút của API. */
export const PREVIEW_DEBOUNCE_MS = 300;

/** Giá trị chỉ đổi sau khi đứng yên `delayMs` (debounce); giỏ dùng chung để hỏi giá phần chọn cùng nhịp với xem trước mã. */
export function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return settled;
}

/**
 * Dấu vân tay các dòng đang tính cho xem trước mức giảm mã: đổi số lượng, giá (giờ vàng) hay dòng là số cũ hết đúng.
 */
export function couponPreviewKey(lines: { id: string; quantity: number; total: number }[]): string {
  return lines.map((l) => `${l.id}:${l.quantity}:${l.total}`).join(',');
}

/** Khoá mutation dùng chung để trang chứa (thanh toán) biết mã đang được đổi qua `useIsMutating`. */
export const COUPON_MUTATION_KEY = ['cart-coupon'] as const;

/**
 * Chọn/nhập Mã giảm giá cho giỏ hàng — dùng ở giỏ hàng và thanh toán.
 *
 * Web trước đây chỉ HIỂN THỊ `cart.discount` mà không có chỗ nào áp mã, còn Mini App thì có đủ:
 * cùng một giỏ, khách có mã WELCOME30 trong ví mà mua trên web vẫn trả nguyên giá — rồi khiếu
 * nại, CSKH phải huỷ đơn tạo lại. Mã nằm trên giỏ, nên đổi mã xong phải tải lại báo giá thanh toán
 * (`['quote', …]`), nếu không tổng tiền trên màn hình còn là con số cũ.
 */
export function CouponBox({
  currentCode,
  subtotal,
  shippingFee = null,
  notice = null,
  disabled = false,
  preview,
  previewKey,
}: {
  currentCode: string | null;
  subtotal: number;
  /** Phí vận chuyển đã tính của đơn (thanh toán); chưa biết thì null và thẻ freeship không nói được số tiền. */
  shippingFee?: number | null;
  /** Mã đang giữ nhưng chưa áp cho đơn (server giải thích lý do, vd hàng giờ vàng không tính vào điều kiện). */
  notice?: string | null;
  /** Trang chứa đang đặt hàng: đổi mã lúc này làm đơn lấy mã khác với con số khách đã thấy. */
  disabled?: boolean;
  /**
   * Tham số báo giá của lần đặt đang xem (thanh toán: có addressId; giỏ: không). Có thì hỏi máy chủ mức giảm thật từng mã;
   * không có, đang tải hoặc lỗi (API cũ) thì thẻ chỉ ghi điều kiện của mã như trước.
   */
  preview?: CouponPreviewParams;
  /**
   * Dấu vân tay các dòng đang tính (`couponPreviewKey`): `itemIds` không đổi khi đổi số lượng hay khi chọn cả giỏ, nên đổi
   * dấu này là số xem trước cũ hết đúng và phải hỏi lại.
   */
  previewKey?: string;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Thu gọn mặc định: ô nhập + danh sách voucher dài hàng trăm px, đẩy nút thanh toán xuống khỏi màn điện thoại.
  const [open, setOpen] = useState(false);
  const couponsQ = useQuery({ queryKey: ['my-coupons'], queryFn: getMyCoupons });
  const previewSig = preview ? JSON.stringify([preview, previewKey ?? '']) : null;
  const settledSig = useSettled(previewSig, PREVIEW_DEBOUNCE_MS);
  const previewsQ = useQuery({
    queryKey: ['coupon-previews', settledSig],
    queryFn: () => getCouponPreviews((JSON.parse(settledSig!) as [CouponPreviewParams, string])[0]),
    // Ví không có mã nào thì không có gì để tính: khỏi gọi máy chủ mỗi lần đổi giỏ.
    enabled: !!settledSig && !currentCode && (couponsQ.data?.length ?? 0) > 0,
    retry: false,
  });
  // Số chỉ đúng cho đúng giỏ đã hỏi: giỏ vừa đổi (chưa hỏi lại) hoặc đang tải lại thì quay về phép đoán phía máy, không hiện số cũ.
  const previewTrusted = !!previewSig && settledSig === previewSig && previewsQ.isSuccess && !previewsQ.isFetching;
  const previews = new Map((previewTrusted ? (previewsQ.data ?? []) : []).map((p) => [p.code.toUpperCase(), p]));
  const usable = (c: { code: string; minOrder: number | null }) => {
    const p = previews.get(c.code.toUpperCase());
    return p ? p.eligible : isCouponEligible(c, subtotal);
  };

  const afterChange = (cart: Awaited<ReturnType<typeof applyCoupon>>) => {
    qc.setQueryData(cartKey(), cart);
    void qc.invalidateQueries({ queryKey: ['quote'] });
  };
  const apply = useMutation({
    mutationKey: COUPON_MUTATION_KEY,
    mutationFn: (c: string) => applyCoupon(c.trim().toUpperCase()),
    onSuccess: (cart) => {
      setErr(null);
      setCode('');
      afterChange(cart);
    },
    onError: (e) => {
      setErr(e instanceof Error ? e.message : 'Không áp dụng được mã giảm giá');
      // Khách có thể đã thu gọn trong lúc chờ: đưa ô nhập ra lại để sửa mã.
      setOpen(true);
    },
  });
  const drop = useMutation({
    mutationKey: COUPON_MUTATION_KEY,
    mutationFn: removeCoupon,
    onSuccess: afterChange,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không bỏ được mã giảm giá'),
  });
  const busy = apply.isPending || drop.isPending || disabled;

  return (
    <div className="mt-3 border-t border-stone-200 pt-3">
      {currentCode ? (
        <div className="flex items-center justify-between rounded-control border border-dashed border-promo-solid bg-promo-bg pl-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-promo-fg">
            <Ticket className="h-4 w-4" aria-hidden="true" /> {currentCode}
          </span>
          <button
            type="button"
            onClick={() => drop.mutate()}
            disabled={busy}
            aria-label={`Bỏ mã giảm giá ${currentCode}`}
            className="flex h-11 w-11 items-center justify-center text-promo-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="coupon-panel"
            className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-semibold text-stone-900"
          >
            <span className="inline-flex items-center gap-2">
              <Ticket className="h-4 w-4 text-promo-fg" aria-hidden="true" />
              Mã giảm giá
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-forest-700">
              {(couponsQ.data?.length ?? 0) > 0 ? `Bạn có ${couponsQ.data!.length} mã` : 'Thêm mã'}
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </span>
          </button>
          <div id="coupon-panel" hidden={!open}>
            <label htmlFor="coupon-code" className="sr-only">
              Mã giảm giá
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="coupon-code"
                name="coupon-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Nhập mã giảm giá"
                autoCapitalize="characters"
                autoComplete="off"
                className={`${ui.field} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => apply.mutate(code)}
                disabled={!code.trim() || busy}
                className={`${ui.btnPrimary} px-4`}
              >
                Áp dụng
              </button>
            </div>
            {(couponsQ.data?.length ?? 0) > 0 && (
              <>
                <ul aria-label="Mã giảm giá của bạn" className="mt-3 space-y-2">
                  {(previews.size > 0
                    ? [...couponsQ.data!.filter(usable), ...couponsQ.data!.filter((c) => !usable(c))]
                    : sortCouponsForCart(couponsQ.data!, subtotal)
                  )
                    .slice(0, showAll ? undefined : VISIBLE_COUPONS)
                    .map((c) => {
                      const pv = previews.get(c.code.toUpperCase());
                      // Có số của máy chủ thì theo số đó; các phép đoán dưới đây chỉ dùng khi chưa có (API cũ, đang tải, lỗi).
                      const redundant = !pv && isFreeshipRedundant(c, shippingFee);
                      const meetsMin = !!pv || isCouponEligible(c, subtotal);
                      const serverBlocked = !!pv && !pv.eligible;
                      const eligible = meetsMin && !redundant && !serverBlocked;
                      const saving = !pv
                        ? null
                        : pv.discount > 0
                          ? `Giảm ${formatVnd(pv.discount)} cho đơn này`
                          : (pv.freeshipSaving ?? 0) > 0
                            ? `Miễn phí ship ${formatVnd(pv.freeshipSaving!)} cho đơn này`
                            : null;
                      return (
                        <li
                          key={c.code}
                          className={`flex items-center gap-3 rounded-control border border-dashed border-promo-solid bg-promo-bg p-3 ${
                            eligible ? '' : redundant ? 'opacity-60' : 'opacity-80'
                          }`}
                        >
                          <Ticket className="h-5 w-5 flex-none text-promo-fg" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <div className="break-all text-sm font-bold text-promo-fg">{autoCouponName(c.code) ?? c.code}</div>
                            <div className="text-xs text-stone-800">{couponValueLabel(c)}</div>
                            {saving && <div className="text-xs font-semibold text-success-fg">{saving}</div>}
                            {serverBlocked && pv.reason && <div className="text-xs font-medium text-warning-fg">{pv.reason}</div>}
                            {redundant && <div className="text-xs text-stone-700">Đơn này đã miễn phí vận chuyển</div>}
                            {c.minOrder != null && (
                              <div className={`text-xs ${meetsMin ? 'text-stone-700' : 'font-medium text-warning-fg'}`}>
                                {meetsMin
                                  ? `Đơn tối thiểu ${formatVnd(c.minOrder)}`
                                  : `Cần đơn tối thiểu ${formatVnd(c.minOrder)} — mua thêm ${formatVnd(c.minOrder - subtotal)} để dùng mã này`}
                              </div>
                            )}
                            <div className="text-xs text-stone-700">{couponExpiryLabel(c.endAt)}</div>
                          </div>
                          <button
                            type="button"
                            disabled={!eligible || busy}
                            onClick={() => apply.mutate(c.code)}
                            aria-label={`${redundant ? 'Không cần dùng' : 'Dùng'} mã ${autoCouponName(c.code) ?? c.code}`}
                            className={`${ui.btnPrimary} flex-none px-3`}
                          >
                            {redundant ? 'Không cần' : serverBlocked ? 'Không áp dụng' : eligible ? 'Dùng mã' : 'Chưa đủ'}
                          </button>
                        </li>
                      );
                    })}
                </ul>
                {couponsQ.data!.length > VISIBLE_COUPONS && (
                  <button type="button" onClick={() => setShowAll((v) => !v)} className={`${ui.btnText} mt-1 text-forest-700`}>
                    {showAll ? 'Thu gọn' : `Xem thêm ${couponsQ.data!.length - VISIBLE_COUPONS} mã`}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      {currentCode && notice && (
        <p role="status" data-testid="coupon-notice" className="mt-2 text-xs text-warning-fg">
          {notice}
        </p>
      )}
      {err && (
        <p role="alert" className="mt-2 text-xs text-danger-fg">
          {err}
        </p>
      )}
    </div>
  );
}
