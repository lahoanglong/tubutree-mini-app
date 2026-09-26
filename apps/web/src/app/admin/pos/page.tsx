'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { PosScreen } from '@/components/admin/pos-screen';

/** Màn thu ngân tích Điểm Xanh tại quầy — cho STAFF và ADMIN (API kiểm lại role trong DB). */
export default function PosPage() {
  const { user, status, initialized } = useAuth();

  if (!initialized || status === 'loading') return <Center>Đang tải…</Center>;
  if (status !== 'authenticated')
    return (
      <Center>
        Cần đăng nhập tài khoản nhân viên.{' '}
        <Link href="/dang-nhap" className="font-semibold text-green-700 underline">
          Đăng nhập
        </Link>
      </Center>
    );
  if (user?.role !== 'STAFF' && user?.role !== 'ADMIN')
    return <Center>Chỉ nhân viên hoặc quản trị viên mới dùng được màn thu ngân.</Center>;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Thu ngân · Tích Điểm Xanh tại quầy</h1>
        {user.role === 'ADMIN' && (
          <Link href="/admin?tab=posCredits" className="text-sm font-medium text-green-700 underline">
            Sổ tích điểm tại quầy →
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-neutral-500">Đăng nhập: {user.fullName ?? 'Nhân viên'} · mọi lượt tích điểm được ghi sổ theo tài khoản này.</p>
      <div className="mt-4">
        <PosScreen />
      </div>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-20 text-center text-neutral-600">{children}</main>;
}
