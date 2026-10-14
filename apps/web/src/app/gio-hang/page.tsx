'use client';

import Link from 'next/link';
import { ShoppingBag, Truck, Leaf } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthPhase } from '@/lib/auth-phase';
import { getCart, updateCartItem, removeCartItem, formatVnd } from '@/lib/shop-client';
import { CouponBox } from '@/components/coupon-box';
import { AuthLoading, LoginRequired } from '@/components/login-required';
import { ui } from '@/lib/guest-ui';
import { fulfillerLabel, groupByFulfiller, showFulfillerHeaders, tubuSubtotal } from '@/lib/shipments';

export default function CartPage() {
  const phase = useAuthPhase();
  const qc = useQueryClient();
  const cartQ = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: phase === 'authenticated' });

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

  if (phase === 'loading') {
    return (
      <Shell>
        <AuthLoading />
      </Shell>
    );
  }

  if (phase === 'guest') {
    return (
      <Shell>
        <LoginRequired message="Đăng nhập để xem giỏ hàng của bạn." returnTo="/gio-hang" />
      </Shell>
    );
  }

  const cart = cartQ.data;
  // Checkout sẽ từ chối dòng hết hàng/vượt tồn: chặn từ giỏ để khách biết phải sửa gì thay vì gặp lỗi ở bước sau.
  const stockBlocked = !!cart?.items.some((it) => it.stock <= 0 || it.quantity > it.stock);
  // Mỗi nơi giao thành một đơn riêng khi đặt (D4): chia giỏ theo nơi giao để khách thấy trước.
  const groups = groupByFulfiller(cart?.items ?? []);
  const withHeaders = showFulfillerHeaders(groups);
  const hasMerchant = groups.some((g) => g.fulfiller.kind === 'MERCHANT');
  const freeshipBase = cart ? (hasMerchant ? tubuSubtotal(cart.items) : cart.subtotal) : 0;
  const remainingFreeship =
    cart && (!hasMerchant || freeshipBase > 0) ? Math.max(0, cart.freeshipThreshold - freeshipBase) : 0;

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
                <span className="min-w-0 break-words line-through">
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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="min-w-0 md:col-span-2">
            {!cart.freeship && remainingFreeship > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-card border border-forest-200 bg-forest-50 px-4 py-3 text-sm text-forest-800">
                <Truck className="h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
                <span>
                  Mua thêm <strong className="font-bold">{formatVnd(remainingFreeship)}</strong> để được miễn phí vận chuyển
                  {hasMerchant ? ' phần hàng Tubu Tree giao' : ''}
                </span>
              </div>
            )}
            {withHeaders && (
              <p className="mb-3 text-xs text-stone-600">
                Giỏ có hàng do nhiều nơi giao: mỗi nơi giao thành một đơn riêng, có phí giao riêng.
              </p>
            )}
            <div className="space-y-3">
              {groups.map((g) => (
                <section
                  key={g.key}
                  aria-label={withHeaders ? fulfillerLabel(g.fulfiller) : 'Sản phẩm trong giỏ'}
                  className={`divide-y divide-stone-200 ${ui.card}`}
                >
                  {withHeaders && (
                    <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-stone-900">
                      <Truck className="h-4 w-4 text-forest-600" aria-hidden="true" />
                      {fulfillerLabel(g.fulfiller)}
                    </h2>
                  )}
                  {g.items.map((it) => {
                    // Hết hàng / vượt tồn: `+` chỉ làm khách mất dòng (quantity kẹp về 0 → API xoá) mà không báo gì.
                    const soldOut = it.stock <= 0;
                    const atMax = !soldOut && it.quantity >= it.stock;
                    const busy = busyItemId === it.id;
                    return (
                      <div key={it.id} className="flex gap-3 p-3">
                        <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-control bg-forest-50">
                          {it.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.thumbnail} alt={it.productName} className="h-full w-full object-cover" />
                          ) : (
                            <Leaf className="h-6 w-6 text-forest-600" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-sm font-medium text-stone-900">{it.productName}</div>
                          <div className="break-words text-xs text-stone-600">{it.variationName}</div>
                          <div className="mt-1 font-semibold text-stone-900">{formatVnd(it.unitPrice)}</div>
                          {soldOut && (
                            <p className="mt-1 text-xs font-semibold text-danger-fg">Hết hàng — hãy xóa khỏi giỏ để tiếp tục thanh toán</p>
                          )}
                          {!soldOut && atMax && (
                            <p className="mt-1 text-xs font-medium text-warning-fg">Chỉ còn {it.stock} sản phẩm</p>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-x-2">
                            {!soldOut && (
                              <div className="flex items-center rounded-control border border-stone-450 text-sm">
                                <button
                                  type="button"
                                  onClick={() => update.mutate({ id: it.id, q: Math.max(1, Math.min(it.stock, it.quantity - 1)) })}
                                  disabled={busy}
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
                                  onClick={() => update.mutate({ id: it.id, q: it.quantity + 1 })}
                                  disabled={busy || atMax}
                                  aria-label={`Tăng số lượng ${it.productName}`}
                                  className="h-11 w-11 text-lg disabled:opacity-40"
                                >
                                  +
                                </button>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => remove.mutate(it.id)}
                              disabled={busy}
                              aria-label={`Xóa ${it.productName} khỏi giỏ hàng`}
                              className={`inline-flex min-h-11 items-center px-3 text-sm font-medium text-danger-fg disabled:opacity-40 ${
                                soldOut ? 'rounded-control border border-danger-fg font-semibold' : ''
                              }`}
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
                    );
                  })}
                </section>
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
            <CouponBox currentCode={cart.couponCode} subtotal={cart.subtotal} notice={cart.couponNotice} />
            <div className="mt-3 flex justify-between border-t border-stone-200 pt-3 font-bold text-stone-900">
              <span>Tổng</span>
              <span>{formatVnd(cart.subtotal - cart.discount)}</span>
            </div>
            {stockBlocked ? (
              <>
                <button type="button" disabled className={`${ui.btnPrimary} mt-4 w-full`}>
                  Thanh toán ({cart.itemCount})
                </button>
                <p role="alert" className="mt-2 text-xs text-danger-fg">
                  Có sản phẩm đã hết hàng hoặc vượt số lượng còn lại. Hãy xóa hoặc giảm số lượng rồi thanh toán.
                </p>
              </>
            ) : (
              <Link href="/thanh-toan" className={`${ui.btnPrimary} mt-4 w-full`}>
                Thanh toán ({cart.itemCount})
              </Link>
            )}
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
