'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { CockpitBoard } from './cockpit-board';
import { PilotOrdersPanel } from './pilot-orders-panel';

/**
 * "Bảng kiểm Giờ G": một màn xem đủ 6 nhóm điều kiện mở bán (cùng bộ kiểm với `pnpm go-live:check`, chạy trong API đang phục vụ) và bàn
 * dọn đơn thử sau buổi thử (docs/launch/pilot-order-playbook.md). Chỉ ADMIN: các điểm cuối `admin/golive` chỉ nhận ADMIN.
 */
export default function GoLiveCockpitPage() {
  const { user, status, initialized } = useAuth();

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
  if (user?.role !== 'ADMIN') return <Center>Chỉ quản trị viên mới xem được Bảng kiểm Giờ G.</Center>;

  return (
    <main id="admin-main" className="mx-auto w-full max-w-2xl px-4 py-6 text-stone-900 md:max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 break-words font-display text-xl font-semibold">Bảng kiểm Giờ G</h1>
        <Link href="/admin" className="inline-flex min-h-[44px] items-center text-sm font-medium text-forest-700 underline">
          ← Về trang quản trị
        </Link>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        Đỏ là chặn mở bán, vàng là cần người phụ trách xác nhận. Bấm link dưới mỗi mục để sang đúng chỗ sửa. Bảng kiểm chỉ đọc: không bật tắt cờ nào, không hiện
        giá trị khoá bí mật.
      </p>
      <div className="mt-4">
        <CockpitBoard />
      </div>
      <div className="mt-8 border-t border-stone-200 pt-6">
        <PilotOrdersPanel />
      </div>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-20 text-center text-stone-600">{children}</main>;
}
