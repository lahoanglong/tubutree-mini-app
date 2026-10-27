'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Ticket, X } from 'lucide-react';
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
import { actionErrorText } from '@/lib/error-text';

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

/** Lời báo mã chưa được áp dụng tự tắt sau ngần này, như snackbar cảnh báo của Mini App. */
const APPLY_WARNING_MS = 5000;

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
  actionLabel = 'Chọn mã',
  band = false,
  appliedDiscount = 0,
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
  /** Chữ bên phải thẻ mã khi chưa áp mã nào: giỏ "Chọn mã", thanh toán cũng "Chọn mã" như Mini App. */
  actionLabel?: string;
  /** Thanh toán: dải phẳng tràn ngang như các khối khác của Mini App thay vì thẻ nổi của giỏ. */
  band?: boolean;
  /** Số đã giảm bởi mã đang áp; thẻ điện thoại ghi cạnh chip mã như Mini App. */
  appliedDiscount?: number;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [applyWarning, setApplyWarning] = useState<string | null>(null);
  const warnTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(warnTimer.current), []);
  const showApplyWarning = (text: string | null) => {
    clearTimeout(warnTimer.current);
    setApplyWarning(text);
    if (text) warnTimer.current = setTimeout(() => setApplyWarning(null), APPLY_WARNING_MS);
  };
  // Thu gọn mặc định: ô nhập + danh sách voucher dài hàng trăm px, đẩy nút thanh toán xuống khỏi màn điện thoại.
  const [open, setOpen] = useState(false);
  const couponsQ = useQuery({ queryKey: ['my-coupons'], queryFn: getMyCoupons });
  const previewSig = preview ? JSON.stringify([preview, previewKey ?? '']) : null;
  const settledSig = useSettled(previewSig, PREVIEW_DEBOUNCE_MS);
  const previewsQ = useQuery({
    queryKey: ['coupon-previews', settledSig],
    queryFn: () => getCouponPreviews((JSON.parse(settledSig!) as [CouponPreviewParams, string])[0]),
    // Ví không có mã nào thì không có gì để tính: khỏi gọi máy chủ mỗi lần đổi giỏ.
    enabled: !!settledSig && (!currentCode || open) && (couponsQ.data?.length ?? 0) > 0,
    retry: false,
  });
  // Số chỉ đúng cho đúng giỏ đã hỏi: giỏ vừa đổi (chưa hỏi lại) hoặc đang tải lại thì quay về phép đoán phía máy, không hiện số cũ.
  const previewTrusted =
    !!previewSig && settledSig === previewSig && previewsQ.isSuccess && !previewsQ.isFetching;
  const previews = new Map(
    (previewTrusted ? (previewsQ.data ?? []) : []).map((p) => [p.code.toUpperCase(), p]),
  );
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
    onSuccess: (cart, appliedCode) => {
      setErr(null);
      setCode('');
      setOpen(false);
      // Mã freeship giỏ coi là hợp lệ nhưng xem trước của máy chủ nói không miễn được gì (đơn đã miễn phí giao): nói đúng câu
      // thanh toán sẽ nói thay vì để chip mã hiện như đã áp. Mã giữ nhưng chưa giảm đã có `notice` của giỏ.
      const pv = previews.get(appliedCode.trim().toUpperCase());
      const heldOnly = !!cart.couponNotice && cart.discount === 0 && !cart.freeship && pv?.eligible !== true;
      showApplyWarning(
        !heldOnly && pv && !pv.eligible && pv.reason && cart.discount === 0
          ? `Mã chưa được áp dụng cho đơn này: ${pv.reason}`
          : null,
      );
      afterChange(cart);
    },
    onError: (e) => {
      setErr(actionErrorText(e));
      // Khách có thể đã thu gọn trong lúc chờ: đưa ô nhập ra lại để sửa mã.
      setOpen(true);
    },
  });
  const drop = useMutation({
    mutationKey: COUPON_MUTATION_KEY,
    mutationFn: removeCoupon,
    onSuccess: (cart) => {
      showApplyWarning(null);
      afterChange(cart);
    },
    onError: (e) => setErr(actionErrorText(e)),
  });
  const busy = apply.isPending || drop.isPending || disabled;

  return (
    <div
      className={`mt-3 border-t border-stone-200 pt-3 max-md:mt-0 max-md:border-t-0 max-md:bg-[var(--color-bg-surface)] ${
        band ? 'max-md:p-4' : 'max-md:rounded-card max-md:p-3 max-md:shadow-[var(--elevation-1)]'
      }`}
    >
      {currentCode ? (
        <>
          <div className="flex items-center justify-between rounded-control border border-dashed border-promo-solid bg-promo-bg pl-3 max-md:hidden">
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
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="coupon-panel"
            data-testid="coupon-change"
            className="flex min-h-11 w-full items-center justify-between gap-2 text-left md:hidden"
          >
            <span className="inline-flex items-center gap-2.5">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-control bg-[var(--clay-50)]">
                <Ticket className="h-5 w-5 text-[color:var(--clay-700)]" aria-hidden="true" />
              </span>
              <span className="flex flex-col text-sm font-semibold text-stone-900">
                Mã giảm giá
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-control border border-dashed border-[var(--clay-500)] bg-[var(--clay-50)] px-1.5 py-0.5 text-caption font-bold text-[color:var(--clay-700)]">
                    {currentCode}
                  </span>
                  {appliedDiscount > 0 && (
                    <span className="text-caption font-normal text-success-fg">
                      -{formatVnd(appliedDiscount)}
                    </span>
                  )}
                </span>
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-caption font-medium text-[color:var(--color-text-brand)]">
              Thay đổi
              <ChevronRight
                className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
            </span>
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="coupon-panel"
          className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-semibold text-stone-900"
        >
          <span className="inline-flex items-center gap-2 max-md:gap-2.5">
            <span className="max-md:grid max-md:h-9 max-md:w-9 max-md:flex-none max-md:place-items-center max-md:rounded-control max-md:bg-[var(--clay-50)]">
              <Ticket
                className="h-4 w-4 text-promo-fg max-md:h-5 max-md:w-5 max-md:text-[color:var(--clay-700)]"
                aria-hidden="true"
              />
            </span>
            <span className="flex flex-col">
              Mã giảm giá
              <span className="text-caption font-normal text-stone-600 max-md:text-[color:var(--color-text-tertiary)]">
                Chọn hoặc nhập mã giảm giá
              </span>
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-caption font-medium text-forest-700">
            {actionLabel}
            <ChevronRight
              className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
          </span>
        </button>
      )}
      {(!currentCode || open) && (
        <div id="coupon-panel" hidden={!open} className={currentCode ? 'md:hidden' : undefined}>
          {currentCode && (
            <button
              type="button"
              onClick={() => drop.mutate()}
              disabled={busy}
              className={`${ui.btnText} mt-1 text-danger-fg`}
            >
              Bỏ mã đang áp dụng
            </button>
          )}
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
                    const isApplied = currentCode?.toUpperCase() === c.code.toUpperCase();
                    // Có số của máy chủ thì theo số đó; các phép đoán dưới đây chỉ dùng khi chưa có (API cũ, đang tải, lỗi).
                    const redundant = !isApplied && !pv && isFreeshipRedundant(c, shippingFee);
                    const meetsMin = !!pv || isCouponEligible(c, subtotal);
                    const serverBlocked = !isApplied && !!pv && !pv.eligible;
                    const eligible = meetsMin && !redundant && !serverBlocked;
                    const saving = !pv
                      ? null
                      : pv.discount > 0
                        ? `Giảm ${formatVnd(pv.discount)} cho đơn này`
                        : (pv.freeshipSaving ?? 0) > 0
                          ? `Miễn phí giao hàng ${formatVnd(pv.freeshipSaving!)} cho đơn này`
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
                          <div className="break-all text-sm font-bold text-promo-fg">
                            {autoCouponName(c.code) ?? c.code}
                          </div>
                          <div className="text-caption text-stone-800">{couponValueLabel(c)}</div>
                          {saving && (
                            <div className="text-caption font-semibold text-success-fg">{saving}</div>
                          )}
                          {serverBlocked && pv.reason && (
                            <div className="text-caption font-medium text-warning-fg">{pv.reason}</div>
                          )}
                          {redundant && (
                            <div className="text-caption text-stone-700">
                              Đơn này đã miễn phí giao hàng
                            </div>
                          )}
                          {c.minOrder != null && (
                            <div
                              className={`text-caption ${meetsMin ? 'text-stone-700' : 'font-medium text-warning-fg'}`}
                            >
                              {meetsMin
                                ? `Đơn tối thiểu ${formatVnd(c.minOrder)}`
                                : `Cần đơn tối thiểu ${formatVnd(c.minOrder)} — mua thêm ${formatVnd(c.minOrder - subtotal)} để dùng mã này`}
                            </div>
                          )}
                          <div className="text-caption text-stone-700">{couponExpiryLabel(c.endAt)}</div>
                        </div>
                        <button
                          type="button"
                          disabled={isApplied || !eligible || busy}
                          onClick={() => apply.mutate(c.code)}
                          aria-label={`${isApplied ? 'Đang dùng' : redundant ? 'Không cần dùng' : 'Dùng'} mã ${autoCouponName(c.code) ?? c.code}`}
                          className={`${ui.btnPrimary} flex-none px-3`}
                        >
                          {isApplied
                            ? 'Đang dùng'
                            : redundant
                              ? 'Không cần'
                              : serverBlocked
                                ? 'Không áp dụng'
                                : eligible
                                  ? 'Dùng mã'
                                  : 'Chưa đủ'}
                        </button>
                      </li>
                    );
                  })}
              </ul>
              {couponsQ.data!.length > VISIBLE_COUPONS && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className={`${ui.btnText} mt-1 text-forest-700`}
                >
                  {showAll ? 'Thu gọn' : `Xem thêm ${couponsQ.data!.length - VISIBLE_COUPONS} mã`}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {currentCode && notice && (
        <p role="status" data-testid="coupon-notice" className="mt-2 text-caption text-warning-fg">
          {notice}
        </p>
      )}
      {applyWarning && !(currentCode && notice) && (
        <p role="status" data-testid="coupon-apply-warning" className="mt-2 text-caption text-warning-fg">
          {applyWarning}
        </p>
      )}
      {err && (
        <p role="alert" className="mt-2 text-caption text-danger-fg">
          {err}
        </p>
      )}
    </div>
  );
}
