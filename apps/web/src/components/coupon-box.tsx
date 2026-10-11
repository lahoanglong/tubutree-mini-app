'use client';

import { useState } from 'react';
import { Ticket, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyCoupon, formatVnd, getMyCoupons, removeCoupon } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';

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
  disabled = false,
}: {
  currentCode: string | null;
  subtotal: number;
  /** Trang chứa đang đặt hàng: đổi mã lúc này làm đơn lấy mã khác với con số khách đã thấy. */
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const couponsQ = useQuery({ queryKey: ['my-coupons'], queryFn: getMyCoupons });

  const afterChange = (cart: Awaited<ReturnType<typeof applyCoupon>>) => {
    qc.setQueryData(['cart'], cart);
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
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không áp dụng được mã giảm giá'),
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
          <label htmlFor="coupon-code" className="text-sm font-semibold text-stone-900">
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
            <div className="mt-2 flex flex-wrap gap-2">
              {couponsQ.data!.slice(0, 6).map((c) => {
                const notEligible = c.minOrder != null && subtotal < c.minOrder;
                return (
                  <button
                    key={c.code}
                    type="button"
                    disabled={notEligible || busy}
                    onClick={() => apply.mutate(c.code)}
                    title={notEligible ? `Cần đơn tối thiểu ${formatVnd(c.minOrder!)}` : undefined}
                    className="min-h-11 rounded-control border border-dashed border-promo-solid px-3 text-xs font-semibold text-promo-fg disabled:opacity-50"
                  >
                    {c.code}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {err && (
        <p role="alert" className="mt-2 text-xs text-danger-fg">
          {err}
        </p>
      )}
    </div>
  );
}
