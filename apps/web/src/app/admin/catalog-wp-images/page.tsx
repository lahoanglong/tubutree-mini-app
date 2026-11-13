'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { WpImageTriage } from './wp-image-triage';

/** Duyệt ảnh WordPress cho sản phẩm chưa có ảnh. Chỉ ADMIN: các điểm cuối `admin/catalog-wp-images` của API chỉ nhận ADMIN. */
export default function CatalogWpImagesPage() {
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
  if (user?.role !== 'ADMIN') return <Center>Chỉ quản trị viên mới duyệt được ảnh WordPress.</Center>;

  return (
    <main id="admin-main" className="mx-auto w-full max-w-2xl px-4 py-6 text-stone-900 md:max-w-4xl lg:max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 break-words font-display text-xl font-semibold">Duyệt ảnh WordPress cho sản phẩm</h1>
        <Link href="/admin" className="inline-flex min-h-[44px] items-center text-sm font-medium text-forest-700 underline">
          ← Về trang quản trị
        </Link>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        Đặt ảnh Tubu Tree cạnh ảnh tìm được ở tubutree.com (WordPress cũ). Duyệt thì ảnh được tải về và lưu vào sản phẩm, không dẫn link sang WordPress.
        Chỉ nhóm “Chắc chắn cùng sản phẩm” là cùng sản phẩm; các nhóm còn lại phải đối chiếu bao bì trước khi duyệt.
      </p>
      <div className="mt-4">
        <WpImageTriage />
      </div>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-20 text-center text-stone-600">{children}</main>;
}
