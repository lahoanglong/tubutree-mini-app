'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { formatVnd, getMe } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { pointsSummary } from '@/lib/checkout-points';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { OrdersSection } from './orders-section';
import { ProfileSection } from './profile-section';

const TILE = 'block min-h-11 rounded-control p-2 -m-2 transition hover:bg-forest-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-0';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const phase = useAuthPhase();
  // Hồ sơ trong phiên đăng nhập là ảnh chụp lúc đăng nhập: sau khi đặt đơn dùng điểm, huỷ đơn có tiền về ví hay
  // trả hàng thì số trên thẻ phải đổi ngay. Lấy lại mỗi lần vào trang và mỗi lần quay lại tab thay vì chờ F5;
  // chưa lấy được (mất mạng) thì giữ số cũ.
  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: phase === 'authenticated',
    refetchOnWindowFocus: true,
  });

  if (phase === 'loading') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="sr-only">Tài khoản</h1>
        <AuthLoading />
      </main>
    );
  }

  if (phase === 'unavailable') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className={ui.pageTitle}>Tài khoản</h1>
        <SessionUnavailable />
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
  const balances = meQ.data ?? user;
  const points = pointsSummary(balances);
  const walletBalance = balances.walletBalance;
  // Tên/SĐT lấy từ /me khi đã có (khách có thể vừa đổi tên ở Mini App); API cũ chưa trả thì dùng ảnh chụp lúc đăng nhập.
  const fullName = meQ.data?.fullName !== undefined ? meQ.data.fullName : user.fullName;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/" className={ui.backLink}>
        ← Trang chủ
      </Link>
      <h1 className={`mt-1 ${ui.pageTitle}`}>Tài khoản</h1>

      <section aria-label="Thông tin tài khoản" className="mt-3 rounded-sheet bg-forest-800 p-5 text-stone-0 shadow-raised">
        <div className="text-lg font-bold">{fullName ?? 'Khách Tubu'}</div>
        <div className="mt-1 text-sm text-forest-100">Mã giới thiệu: {user.referralCode}</div>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <Link href="/tai-khoan/diem-xanh" className={TILE}>
            <div className="text-xl font-bold">{points.total.toLocaleString('vi-VN')}</div>
            <div className="text-xs text-forest-100">Điểm Xanh</div>
            {points.convertedNote && <div className="text-xs text-forest-100">{points.convertedNote}</div>}
            <div className="mt-1 inline-flex items-center gap-0.5 text-xs font-semibold text-stone-0 underline">
              Xem lịch sử
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </div>
          </Link>
          <Link href="/tai-khoan/vi-tubu" className={TILE}>
            <div className="text-xl font-bold">{formatVnd(walletBalance)}</div>
            <div className="text-xs text-forest-100">Ví Tubu</div>
            <div className="mt-1 inline-flex items-center gap-0.5 text-xs font-semibold text-stone-0 underline">
              Xem lịch sử
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </div>
          </Link>
        </div>
      </section>

      <ProfileSection name={fullName} phone={meQ.data?.phone} />

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
