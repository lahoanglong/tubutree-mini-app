import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';

/** Khung chung của Học viện, render ở server: tiêu đề và phụ đề đọc được khi chưa có JS; dữ liệu khoá học cần đăng nhập nên nạp ở client. */
export function AcademyShell({ children, withSubtitle }: { children: ReactNode; withSubtitle: boolean }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 max-md:pt-0">
      <PageHeader title="Học viện CTV" subtitle={withSubtitle ? 'Học kỹ năng bán hàng, làm CTV giỏi hơn mỗi ngày' : undefined} />
      <div className="mt-4">{children}</div>
    </main>
  );
}
