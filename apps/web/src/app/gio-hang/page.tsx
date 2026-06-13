'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { getCart, updateCartItem, removeCartItem, formatVnd } from '@/lib/shop-client';

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

  if (status !== 'authenticated') {
    return (
      <Shell>
        <div className="py-20 text-center">
          <p className="text-neutral-600">Vui lòng đăng nhập để xem giỏ hàng.</p>
          <Link href="/dang-nhap" className="mt-4 inline-block rounded-full bg-green-600 px-6 py-2.5 font-semibold text-white">
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
      {cartQ.isLoading ? (
        <p className="py-10 text-center text-neutral-400">Đang tải giỏ hàng…</p>
      ) : !cart || cart.items.length === 0 ? (
        <div className="py-20 text-center">
          <div className="text-5xl">🛒</div>
          <p className="mt-4 text-neutral-600">Giỏ hàng trống</p>
          <Link href="/" className="mt-4 inline-block rounded-full bg-green-600 px-6 py-2.5 font-semibold text-white">
            Khám phá sản phẩm
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            {!cart.freeship && remainingFreeship > 0 && (
              <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Mua thêm {formatVnd(remainingFreeship)} để được miễn phí vận chuyển 🚚
              </p>
            )}
            <div className="divide-y rounded-lg border border-neutral-100 bg-white">
              {cart.items.map((it) => (
                <div key={it.id} className="flex gap-3 p-3">
                  <div className="flex h-16 w-16 flex-none items-center justify-center rounded bg-green-50 text-2xl">
                    {it.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.thumbnail} alt={it.productName} className="h-full w-full rounded object-cover" />
                    ) : (
                      '🌿'
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{it.productName}</div>
                    <div className="text-xs text-neutral-400">{it.variationName}</div>
                    <div className="mt-1 font-semibold text-clay-700">{formatVnd(it.unitPrice)}</div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex items-center rounded border border-neutral-200 text-sm">
                        <button onClick={() => update.mutate({ id: it.id, q: Math.max(1, it.quantity - 1) })} className="px-2 py-1">−</button>
                        <span className="w-7 text-center">{it.quantity}</span>
                        <button onClick={() => update.mutate({ id: it.id, q: Math.min(it.stock, it.quantity + 1) })} className="px-2 py-1">+</button>
                      </div>
                      <button onClick={() => remove.mutate(it.id)} className="text-xs text-red-500">Xóa</button>
                    </div>
                  </div>
                  <div className="flex-none font-semibold">{formatVnd(it.total)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="h-fit rounded-lg border border-neutral-100 bg-white p-4">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-600">Tạm tính</span>
              <span>{formatVnd(cart.subtotal)}</span>
            </div>
            {cart.discount > 0 && (
              <div className="mt-1 flex justify-between text-sm text-green-700">
                <span>Giảm giá</span>
                <span>-{formatVnd(cart.discount)}</span>
              </div>
            )}
            <div className="mt-3 flex justify-between border-t pt-3 font-bold">
              <span>Tổng</span>
              <span className="text-clay-700">{formatVnd(cart.subtotal - cart.discount)}</span>
            </div>
            <Link
              href="/thanh-toan"
              className="mt-4 block rounded-md bg-green-600 px-6 py-3 text-center font-medium text-white hover:bg-green-700"
            >
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
      <Link href="/" className="text-sm text-green-600">← Tiếp tục mua sắm</Link>
      <h1 className="mt-3 text-xl font-bold">Giỏ hàng</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}
