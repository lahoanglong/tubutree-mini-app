'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { fetchOrders, formatVnd } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { RecyclingStatus } from '@/components/recycling-status';

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã hủy',
};

// Chờ thanh toán là việc khách còn phải làm nên dùng màu cảnh báo; đơn đã hủy/hoàn là trạng thái kết thúc.
function statusTone(status: string): string {
  if (status === 'PENDING_PAYMENT') return 'bg-warning-bg text-warning-fg';
  if (status === 'CANCELLED' || status === 'RETURNED') return 'bg-stone-100 text-stone-700';
  return 'bg-forest-50 text-forest-800';
}

export default function AccountPage() {
  const { user, status, logout } = useAuth();
  const ordersQ = useQuery({ queryKey: ['orders'], queryFn: fetchOrders, enabled: status === 'authenticated' });

  if (status === 'idle' || status === 'loading') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="sr-only">Tài khoản</h1>
        <p className="text-stone-600">Đang tải…</p>
      </main>
    );
  }

  if (status !== 'authenticated' || !user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className={ui.pageTitle}>Tài khoản</h1>
        <p className="mt-3 text-stone-700">Vui lòng đăng nhập để xem tài khoản.</p>
        <Link href="/dang-nhap" className={`${ui.btnPrimary} mt-4`}>
          Đăng nhập với Zalo
        </Link>
      </main>
    );
  }

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
            <div className="text-xl font-bold">{user.pointsBalance}</div>
            <div className="text-xs text-forest-100">Điểm Xanh</div>
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
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusTone(o.status)}`}>
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-stone-600">
                  {o.items.length} sản phẩm · {new Date(o.createdAt).toLocaleDateString('vi-VN')}
                </div>
                <div className="mt-1 font-semibold text-stone-900">{formatVnd(o.total)}</div>
                <RecyclingStatus order={o} />
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
