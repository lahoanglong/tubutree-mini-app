'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { fetchOrders, formatVnd } from '@/lib/shop-client';
import { canPayAgain, orderDetailHref, orderStatusLabel, orderStatusTone } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { pointsSummary } from '@/lib/checkout-points';
import { RecyclingStatus } from '@/components/recycling-status';
import { formatDate } from '@/lib/format-date';
import { AuthLoading, LoginRequired } from '@/components/login-required';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const phase = useAuthPhase();
  const ordersQ = useQuery({ queryKey: ['orders'], queryFn: fetchOrders, enabled: phase === 'authenticated' });

  if (phase === 'loading') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="sr-only">Tài khoản</h1>
        <AuthLoading />
      </main>
    );
  }

  if (phase === 'guest' || !user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className={ui.pageTitle}>Tài khoản</h1>
        <LoginRequired message="Đăng nhập để xem tài khoản và đơn hàng của bạn." returnTo="/tai-khoan" />
      </main>
    );
  }

  // Điểm Xanh = lô thường + lô quy đổi (tiền trả trước, không hết hạn): cùng một con số với Mini App.
  const points = pointsSummary(user);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/" className={ui.backLink}>
        ← Trang chủ
      </Link>
      <h1 className={`mt-1 ${ui.pageTitle}`}>Tài khoản</h1>

      <section aria-label="Thông tin tài khoản" className="mt-3 rounded-sheet bg-forest-800 p-5 text-stone-0 shadow-raised">
        <div className="text-lg font-bold">{user.fullName ?? 'Khách Tubu'}</div>
        <div className="mt-1 text-sm text-forest-100">Mã giới thiệu: {user.referralCode}</div>
        <div className="mt-3 flex gap-6">
          <div>
            <div className="text-xl font-bold">{points.total.toLocaleString('vi-VN')}</div>
            <div className="text-xs text-forest-100">Điểm Xanh</div>
            {points.convertedNote && <div className="text-xs text-forest-100">{points.convertedNote}</div>}
          </div>
          <div>
            <div className="text-xl font-bold">{formatVnd(user.walletBalance)}</div>
            <div className="text-xs text-forest-100">Ví Tubu</div>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className={ui.sectionTitle}>Đơn hàng của tôi</h2>
        {ordersQ.isLoading ? (
          <p className="py-6 text-center text-stone-600">Đang tải…</p>
        ) : ordersQ.isError ? (
          <div className={`mt-3 p-6 text-center ${ui.card}`}>
            <p className={ui.error}>Không tải được danh sách đơn hàng.</p>
            <button type="button" onClick={() => void ordersQ.refetch()} className={`${ui.btnText} mt-1 text-forest-700`}>
              Thử lại
            </button>
          </div>
        ) : ordersQ.data && ordersQ.data.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {ordersQ.data.map((o) => (
              <li key={o.code} className={`p-4 ${ui.card}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-stone-900">#{o.code}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${orderStatusTone(o.status)}`}>
                    {orderStatusLabel(o.status)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-stone-600">
                  {o.items.length} sản phẩm · {formatDate(o.createdAt)}
                </div>
                <div className="mt-1 font-semibold text-stone-900">{formatVnd(o.total)}</div>
                <RecyclingStatus order={o} />
                {/* Đơn chuyển khoản còn chờ tiền: lối riêng "Thanh toán" vì đó là việc khách còn phải làm. */}
                {canPayAgain(o) ? (
                  <Link href={orderDetailHref(o.code)} aria-label={`Thanh toán đơn ${o.code}`} className={`${ui.btnPrimary} mt-2`}>
                    Thanh toán
                  </Link>
                ) : (
                  <Link
                    href={orderDetailHref(o.code)}
                    aria-label={`Xem chi tiết đơn ${o.code}`}
                    className={`${ui.btnText} -ml-2 mt-1 text-forest-700`}
                  >
                    Xem chi tiết
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-3 p-6 text-center text-sm text-stone-600 ${ui.card}`}>Bạn chưa có đơn hàng nào.</p>
        )}
      </section>

      <button type="button" onClick={() => void logout()} className={`${ui.btnSecondary} mt-6 w-full`}>
        Đăng xuất
      </button>
    </main>
  );
}
