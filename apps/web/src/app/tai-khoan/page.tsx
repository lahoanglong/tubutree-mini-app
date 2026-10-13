'use client';

import Link from 'next/link';
import { ChevronRight, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { formatVnd } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { pointsSummary } from '@/lib/checkout-points';
import { AuthLoading, LoginRequired } from '@/components/login-required';
import { OrdersSection } from './orders-section';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const phase = useAuthPhase();

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

      <nav aria-label="Quản lý tài khoản" className="mt-4">
        <Link href="/tai-khoan/dia-chi" className={`${ui.card} flex min-h-11 items-center justify-between gap-3 p-4 text-sm font-semibold text-stone-900 hover:bg-stone-50`}>
          <span className="inline-flex items-center gap-2">
            <MapPin className="h-5 w-5 text-forest-600" aria-hidden="true" />
            Sổ địa chỉ
          </span>
          <ChevronRight className="h-4 w-4 text-stone-600" aria-hidden="true" />
        </Link>
      </nav>

      <OrdersSection />

      <button type="button" onClick={() => void logout()} className={`${ui.btnSecondary} mt-6 w-full`}>
        Đăng xuất
      </button>
    </main>
  );
}
