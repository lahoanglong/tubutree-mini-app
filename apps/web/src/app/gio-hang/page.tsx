'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShoppingBag, Truck, Leaf, Ticket, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import {
  getCart,
  updateCartItem,
  removeCartItem,
  formatVnd,
  getMyCoupons,
  applyCoupon,
  removeCoupon,
} from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';

export default function CartPage() {
  const { status } = useAuth();
  const qc = useQueryClient();
  const cartQ = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: status === 'authenticated' });

  const update = useMutation({
    mutationFn: ({ id, q }: { id: string; q: number }) => updateCartItem(id, q),
    onSuccess: (data) => qc.setQueryData(['cart'], data),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeCartItem(id),
    onSuccess: (data) => qc.setQueryData(['cart'], data),
  });
  // Chặn double-click/race trên cùng 1 dòng: trong lúc đang cập nhật/xóa 1 item, khóa các
  // nút của đúng item đó (item khác vẫn thao tác được bình thường).
  const busyItemId =
    (update.isPending ? update.variables?.id : null) ?? (remove.isPending ? remove.variables : null);
  const failedItemId =
    (update.isError ? update.variables?.id : null) ?? (remove.isError ? remove.variables : null);

  if (status === 'idle' || status === 'loading') {
    return (
      <Shell>
        <div className="py-20 text-center">
          <p className="text-stone-600">Đang tải…</p>
        </div>
      </Shell>
    );
  }

  if (status !== 'authenticated') {
    return (
      <Shell>
        <div className="py-20 text-center">
          <p className="text-stone-700">Vui lòng đăng nhập để xem giỏ hàng.</p>
          <Link href="/dang-nhap" className={`${ui.btnPrimary} mt-4`}>
            Đăng nhập với Zalo
          </Link>
        </div>
      </Shell>
    );
  }

  const cart = cartQ.data;
  const remainingFreeship = cart ? Math.max(0, cart.freeshipThreshold - cart.subtotal) : 0;

  return (
    <Shell>
      {cart && (cart.unavailableItems?.length ?? 0) > 0 && (
        <div
          role="status"
          className="mb-3 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg"
        >
          <p className="font-semibold">{cart.unavailableItems!.length} sản phẩm đã ngừng bán</p>
          <p className="mt-0.5">Không thể đặt các sản phẩm này nên đã được tách khỏi đơn của bạn.</p>
          <ul className="mt-2 space-y-1">
            {cart.unavailableItems!.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2">
                <span className="line-through">
                  {it.productName}
                  {it.variationName ? ` · ${it.variationName}` : ''} × {it.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => remove.mutate(it.id)}
                  disabled={remove.isPending && remove.variables === it.id}
                  aria-label={`Xoá ${it.productName} khỏi giỏ hàng`}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-control px-3 font-semibold underline disabled:opacity-50"
                >
                  Xoá
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cartQ.isLoading ? (
        <p className="py-10 text-center text-stone-600">Đang tải giỏ hàng…</p>
      ) : cartQ.isError ? (
        <div className="py-20 text-center">
          <p className="text-stone-700">Không tải được giỏ hàng.</p>
          <button type="button" onClick={() => void cartQ.refetch()} className={`${ui.btnPrimary} mt-4`}>
            Thử lại
          </button>
        </div>
      ) : !cart || cart.items.length === 0 ? (
        <div className="py-20 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
            <ShoppingBag className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold text-stone-900">Giỏ hàng đang trống</h2>
          <p className="mt-1 text-sm text-stone-600">Khám phá các sản phẩm xanh và bảo vệ môi trường cùng Tubu Tree</p>
          <Link href="/" className={`${ui.btnPrimary} mt-5`}>
            Khám phá sản phẩm
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            {!cart.freeship && remainingFreeship > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-card border border-forest-200 bg-forest-50 px-4 py-3 text-sm text-forest-800">
                <Truck className="h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
                <span>
                  Mua thêm <strong className="font-bold">{formatVnd(remainingFreeship)}</strong> để được miễn phí vận chuyển
                </span>
              </div>
            )}
            <div className={`divide-y divide-stone-200 ${ui.card}`}>
              {cart.items.map((it) => (
                <div key={it.id} className="flex gap-3 p-3">
                  <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-control bg-forest-50">
                    {it.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.thumbnail} alt={it.productName} className="h-full w-full object-cover" />
                    ) : (
                      <Leaf className="h-6 w-6 text-forest-600" aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-stone-900">{it.productName}</div>
                    <div className="text-xs text-stone-600">{it.variationName}</div>
                    <div className="mt-1 font-semibold text-stone-900">{formatVnd(it.unitPrice)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2">
                      <div className="flex items-center rounded-control border border-stone-450 text-sm">
                        <button
                          type="button"
                          onClick={() => update.mutate({ id: it.id, q: Math.max(1, it.quantity - 1) })}
                          disabled={busyItemId === it.id}
                          aria-label={`Giảm số lượng ${it.productName}`}
                          className="h-11 w-11 text-lg disabled:opacity-40"
                        >
                          −
                        </button>
                        <span className="w-7 text-center text-stone-900" aria-live="polite">
                          {it.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => update.mutate({ id: it.id, q: Math.min(it.stock, it.quantity + 1) })}
                          disabled={busyItemId === it.id}
                          aria-label={`Tăng số lượng ${it.productName}`}
                          className="h-11 w-11 text-lg disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove.mutate(it.id)}
                        disabled={busyItemId === it.id}
                        aria-label={`Xóa ${it.productName} khỏi giỏ hàng`}
                        className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-danger-fg disabled:opacity-40"
                      >
                        Xóa
                      </button>
                    </div>
                    {failedItemId === it.id && (
                      <p role="alert" className="mt-1 text-xs text-danger-fg">
                        {(update.error ?? remove.error) instanceof Error
                          ? (update.error ?? remove.error)?.message
                          : 'Cập nhật giỏ hàng thất bại.'}
                      </p>
                    )}
                  </div>
                  <div className="flex-none font-semibold text-stone-900">{formatVnd(it.total)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={`h-fit p-4 ${ui.card}`}>
            <div className="flex justify-between text-sm">
              <span className="text-stone-600">Tạm tính</span>
              <span className="text-stone-900">{formatVnd(cart.subtotal)}</span>
            </div>
            {cart.discount > 0 && (
              <div className="mt-1 flex justify-between text-sm text-success-fg">
                <span>Giảm giá{cart.couponCode ? ` (${cart.couponCode})` : ''}</span>
                <span>-{formatVnd(cart.discount)}</span>
              </div>
            )}
            <CouponBox currentCode={cart.couponCode} subtotal={cart.subtotal} />
            <div className="mt-3 flex justify-between border-t border-stone-200 pt-3 font-bold text-stone-900">
              <span>Tổng</span>
              <span>{formatVnd(cart.subtotal - cart.discount)}</span>
            </div>
            <Link href="/thanh-toan" className={`${ui.btnPrimary} mt-4 w-full`}>
              Thanh toán ({cart.itemCount})
            </Link>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/" className={ui.backLink}>
        ← Tiếp tục mua sắm
      </Link>
      <h1 className={`mt-1 ${ui.pageTitle}`}>Giỏ hàng</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}

/**
 * Chọn/nhập mã giảm giá.
 *
 * Web trước đây chỉ HIỂN THỊ `cart.discount` mà không có chỗ nào áp mã, còn Mini App thì có đủ:
 * cùng một giỏ, khách có mã WELCOME30 trong ví mà mua trên web vẫn trả nguyên giá — rồi khiếu
 * nại, CSKH phải huỷ đơn tạo lại.
 */
function CouponBox({ currentCode, subtotal }: { currentCode: string | null; subtotal: number }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const couponsQ = useQuery({ queryKey: ['my-coupons'], queryFn: getMyCoupons });

  const apply = useMutation({
    mutationFn: (c: string) => applyCoupon(c.trim().toUpperCase()),
    onSuccess: (cart) => {
      setErr(null);
      setCode('');
      qc.setQueryData(['cart'], cart);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không áp dụng được mã giảm giá'),
  });
  const drop = useMutation({
    mutationFn: removeCoupon,
    onSuccess: (cart) => qc.setQueryData(['cart'], cart),
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không bỏ được mã giảm giá'),
  });
  const busy = apply.isPending || drop.isPending;

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
          <label htmlFor="cart-coupon" className="text-sm font-semibold text-stone-900">
            Mã giảm giá
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="cart-coupon"
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
