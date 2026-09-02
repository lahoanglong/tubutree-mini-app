'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { fetchOrders, formatVnd } from '@/lib/shop-client';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã hủy',
};

export default function AccountPage() {
  const { user, status, logout } = useAuth();
  const ordersQ = useQuery({ queryKey: ['orders'], queryFn: fetchOrders, enabled: status === 'authenticated' });

  if (status === 'idle' || status === 'loading') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-neutral-400">Đang tải…</p>
      </main>
    );
  }

  if (status !== 'authenticated' || !user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-neutral-600">Vui lòng đăng nhập để xem tài khoản.</p>
        <Link href="/dang-nhap" className="mt-4 inline-block rounded-full bg-primary-600 px-6 py-2.5 font-semibold text-white">
          Đăng nhập với Zalo
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/" className="text-sm text-primary-600">← Trang chủ</Link>

      <section className="mt-3 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 p-5 text-white">
        <div className="text-lg font-bold">{user.fullName ?? 'Khách Tubu'}</div>
        <div className="mt-1 text-sm text-primary-100">Mã giới thiệu: {user.referralCode}</div>
        <div className="mt-3 flex gap-6">
          <div>
            <div className="text-xl font-bold">{user.pointsBalance}</div>
            <div className="text-xs text-primary-100">Điểm Xanh</div>
          </div>
          <div>
            <div className="text-xl font-bold">{formatVnd(user.walletBalance)}</div>
            <div className="text-xs text-primary-100">Ví Tubu</div>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Đơn hàng của tôi</h2>
        {ordersQ.isLoading ? (
          <p className="py-6 text-center text-neutral-400">Đang tải…</p>
        ) : ordersQ.isError ? (
          <div className="mt-3 rounded-lg border border-neutral-100 bg-white p-6 text-center">
            <p className="text-sm text-red-600">Không tải được danh sách đơn hàng.</p>
            <button onClick={() => void ordersQ.refetch()} className="mt-2 text-sm font-medium text-primary-600 underline">
              Thử lại
            </button>
          </div>
        ) : ordersQ.data && ordersQ.data.length > 0 ? (
          <div className="mt-3 space-y-3">
            {ordersQ.data.map((o) => (
              <div key={o.code} className="rounded-lg border border-neutral-100 bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">#{o.code}</span>
                  <span className="rounded-full bg-leaf-50 px-2 py-0.5 text-xs text-leaf-700">
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  {o.items.length} sản phẩm · {new Date(o.createdAt).toLocaleDateString('vi-VN')}
                </div>
                <div className="mt-1 font-semibold text-clay-700">{formatVnd(o.total)}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-neutral-100 bg-white p-6 text-center text-sm text-neutral-500">
            Bạn chưa có đơn hàng nào.
          </p>
        )}
      </section>

      <button
        onClick={() => void logout()}
        className="mt-6 w-full rounded-md border border-neutral-200 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50"
      >
        Đăng xuất
      </button>
    </main>
  );
}
