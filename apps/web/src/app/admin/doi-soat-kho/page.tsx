'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { LoadError } from '@/components/admin/ui';
import { getOpsAccess } from '@/lib/admin-client';
import { useAuth } from '@/lib/auth-context';
import { ReconcileBoard } from './reconcile-board';

/**
 * "Đối soát tồn Pancake": so tồn cửa hàng của từng biến thể với số Pancake lần đồng bộ gần nhất, chỉ đọc.
 * ADMIN và nhân viên nhóm KHO (`GET /admin/pancake-reconcile` mở cho KHO); chỉ ADMIN sửa sản phẩm ngay trên trang.
 */
export default function StockReconcilePage() {
  const { user, status, initialized } = useAuth();
  const role = user?.role;
  const accessQ = useQuery({ queryKey: ['admin-ops-access'], queryFn: getOpsAccess, enabled: status === 'authenticated' && role === 'STAFF' });

  if (!initialized || status === 'loading') return <Center>Đang tải…</Center>;
  if (status !== 'authenticated')
    return (
      <Center>
        Cần đăng nhập tài khoản quản trị.{' '}
        <Link href="/dang-nhap" className="inline-flex min-h-[44px] items-center font-semibold text-forest-700 underline">
          Đăng nhập
        </Link>
      </Center>
    );
  if (role === 'STAFF' && accessQ.isLoading) return <Center>Đang tải…</Center>;
  if (role === 'STAFF' && accessQ.isError)
    return (
      <Center>
        <LoadError message="Không tải được quyền của bạn." onRetry={() => accessQ.refetch()} retrying={accessQ.isFetching} />
      </Center>
    );
  const isAdmin = role === 'ADMIN';
  const isKho = role === 'STAFF' && (accessQ.data?.staffPermissions ?? []).includes('KHO');
  if (!isAdmin && !isKho) return <Center>Chỉ quản trị viên và nhân viên kho xem được trang đối soát tồn.</Center>;

  return (
    <main id="admin-main" className="mx-auto w-full max-w-2xl px-4 py-6 text-stone-900 md:max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 break-words font-display text-xl font-semibold">Đối soát tồn Pancake</h1>
        <Link href="/admin" className="inline-flex min-h-[44px] items-center text-sm font-medium text-forest-700 underline">
          ← Về trang quản trị
        </Link>
      </div>
      <p className="mt-1 text-sm text-stone-600">Biến thể hàng kho Tubu đang bán có tồn cửa hàng lệch Pancake, tồn âm, hoặc chưa gắn Pancake.</p>
      <div className="mt-4">
        <ReconcileBoard canEdit={isAdmin} />
      </div>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-20 text-center text-stone-600">{children}</main>;
}
