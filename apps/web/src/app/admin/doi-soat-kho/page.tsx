'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { LoadError, chipClass } from '@/components/admin/ui';
import { getOpsAccess } from '@/lib/admin-client';
import { useAuth } from '@/lib/auth-context';
import { ReconcileBoard } from './reconcile-board';
import { RESTOCK_PLAN_TAB } from './restock-plan-api';
import { RestockPlanner } from './restock-planner';

type StockTab = 'reconcile' | 'plan';

const TABS: { key: StockTab; label: string; title: string; intro: string }[] = [
  {
    key: 'reconcile',
    label: 'Đối soát tồn',
    title: 'Đối soát tồn Pancake',
    intro: 'Biến thể hàng kho Tubu đang bán có tồn cửa hàng lệch Pancake, tồn âm, hoặc chưa gắn Pancake.',
  },
  {
    key: 'plan',
    label: 'Kế hoạch nhập hàng',
    title: 'Kế hoạch nhập hàng',
    intro: 'Số nên đặt nhà cung cấp cho từng biến thể hàng kho Tubu, từ tồn bán được, tốc độ bán 14 ngày và khách đang chờ báo hàng về.',
  },
];

function readTab(): StockTab {
  return new URLSearchParams(window.location.search).get('tab') === RESTOCK_PLAN_TAB ? 'plan' : 'reconcile';
}

/**
 * Trang kho, hai bảng chỉ đọc cùng quyền (ADMIN và nhân viên nhóm KHO):
 * - "Đối soát tồn Pancake" (`GET /admin/pancake-reconcile`): so tồn cửa hàng của từng biến thể với số Pancake lần đồng bộ gần nhất; chỉ ADMIN
 *   sửa sản phẩm ngay trên trang.
 * - "Kế hoạch nhập hàng" (`GET /admin/restock-planner`, `?tab=nhap-hang`): số nên đặt nhà cung cấp và file đặt hàng.
 */
export default function StockReconcilePage() {
  const { user, status, initialized } = useAuth();
  const role = user?.role;
  const accessQ = useQuery({ queryKey: ['admin-ops-access'], queryFn: getOpsAccess, enabled: status === 'authenticated' && role === 'STAFF' });
  // Đọc tab (và để bàn đối soát đọc `flag`/`q`) SAU khi mount: bấm Link từ menu thì Next chỉ đổi URL ở pha commit, lúc render đầu
  // `window.location` còn là trang cũ. Chưa biết tab thì chưa dựng bảng nào, nên bàn đối soát không ghi đè URL trước khi tab được đọc.
  const [tab, setTab] = useState<StockTab | null>(null);
  useEffect(() => setTab(readTab()), []);
  // Bộ lọc bàn đối soát đang có trên URL khi sang tab nhập hàng: quay lại thì trả đúng `flag`/`q` cũ.
  const reconcileSearch = useRef('');
  const selectTab = (next: StockTab) => {
    if (next === tab) return;
    const path = window.location.pathname;
    if (next === 'plan') reconcileSearch.current = window.location.search;
    window.history.replaceState(window.history.state, '', next === 'plan' ? `${path}?tab=${RESTOCK_PLAN_TAB}` : `${path}${reconcileSearch.current}`);
    setTab(next);
  };

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

  if (tab === null) return <Center>Đang tải…</Center>;
  const current = TABS.find((t) => t.key === tab)!;
  return (
    <main id="admin-main" className="mx-auto w-full max-w-2xl px-4 py-6 text-stone-900 md:max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 break-words font-display text-xl font-semibold">{current.title}</h1>
        <Link href="/admin" className="inline-flex min-h-[44px] items-center text-sm font-medium text-forest-700 underline">
          ← Về trang quản trị
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Chọn bảng kho" data-stock-tabs>
        {TABS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => selectTab(t.key)} className={chipClass(tab === t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-stone-600">{current.intro}</p>
      <div className="mt-4">{tab === 'plan' ? <RestockPlanner /> : <ReconcileBoard canEdit={isAdmin} />}</div>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-20 text-center text-stone-600">{children}</main>;
}
