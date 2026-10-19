import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { MiniBar } from '@/components/loyalty/mini-surface';

/** Khung chung của Học viện, render ở server: tiêu đề và phụ đề đọc được khi chưa có JS; dữ liệu khoá học cần đăng nhập nên nạp ở client. */
export function AcademyShell({ children, withSubtitle }: { children: ReactNode; withSubtitle: boolean }) {
  return (
    <main data-page-bleed className="mx-auto max-w-5xl px-4 py-6 max-md:pt-0">
      <MiniBar clearBack>
        <PageHeader title="CTV Academy" subtitle={withSubtitle ? 'Học kỹ năng bán hàng, làm CTV giỏi hơn mỗi ngày' : undefined} />
      </MiniBar>
      <div className="mt-4">{children}</div>
    </main>
  );
}
