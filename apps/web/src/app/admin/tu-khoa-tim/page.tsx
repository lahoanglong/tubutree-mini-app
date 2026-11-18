'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { SearchTermsCard } from '@/components/admin/search-terms-card';

/** "Từ khoá tìm kiếm": từ đồng nghĩa và cụm tìm phổ biến dự phòng của ô tìm. Chỉ ADMIN: `admin/search-synonyms` và khoá cấu hình chỉ nhận ADMIN. */
export default function SearchTermsAdminPage() {
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
  if (user?.role !== 'ADMIN') return <Center>Chỉ quản trị viên mới sửa được từ khoá tìm kiếm.</Center>;

  return (
    <main id="admin-main" className="mx-auto w-full max-w-2xl px-4 py-6 text-stone-900 md:max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 break-words font-display text-xl font-semibold">Từ khoá tìm kiếm</h1>
        <Link href="/admin" className="inline-flex min-h-[44px] items-center text-sm font-medium text-forest-700 underline">
          ← Về trang quản trị
        </Link>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        Từ đồng nghĩa chỉ có tác dụng khi cờ catalog.search_fuzzy_enabled bật, cụm phổ biến dự phòng khi cờ catalog.search_popular_enabled bật (ở Cấu
        hình). Máy chủ lưu từ đồng nghĩa dạng không dấu; thay đổi tới khách sau tối đa 5 phút (từ đồng nghĩa) hoặc 1 giờ (cụm phổ biến).
      </p>
      <div className="mt-4">
        <SearchTermsCard />
      </div>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-20 text-center text-stone-600">{children}</main>;
}
