'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { EcoFactsCard } from '@/components/admin/eco-facts-card';

/** "Sự thật xanh" có nguồn cho nhãn thẻ, trang sản phẩm và Hộ chiếu Xanh. Chỉ ADMIN: các điểm cuối `admin/eco-facts` của API chỉ nhận ADMIN. */
export default function EcoFactsAdminPage() {
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
  if (user?.role !== 'ADMIN') return <Center>Chỉ quản trị viên mới duyệt được sự thật xanh.</Center>;

  return (
    <main id="admin-main" className="mx-auto w-full max-w-2xl px-4 py-6 text-stone-900 md:max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 break-words font-display text-xl font-semibold">Sự thật xanh</h1>
        <Link href="/admin" className="inline-flex min-h-[44px] items-center text-sm font-medium text-forest-700 underline">
          ← Về trang quản trị
        </Link>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        Mỗi dòng là một sự thật về bao bì hay giấy tờ của một sản phẩm, kèm link nguồn. Chỉ dòng đã duyệt mới hiện cho khách, và chỉ khi cờ eco.product_badges_enabled
        (nhãn, trang sản phẩm) hoặc eco.passport_enabled (Hộ chiếu Xanh) bật ở Cấu hình. Không ghi số khi chưa có nguồn.
      </p>
      <div className="mt-4">
        <EcoFactsCard />
      </div>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-20 text-center text-stone-600">{children}</main>;
}
