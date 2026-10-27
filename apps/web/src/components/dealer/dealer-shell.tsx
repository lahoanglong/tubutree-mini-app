import './dealer-theme.css';
import BackLink from '@/components/back-link';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_WIDE } from '@/lib/page-frame';
import { loadErrorText } from '@/lib/error-text';

/** Khung chung của kênh đại lý: mỗi nhánh render có đúng một h1. */
export function DealerShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:min-h-dvh max-md:bg-[var(--color-dealer-bg)]`}
      data-dealer-theme
    >
      <BackLink href="/tai-khoan">
        ← Tài khoản
      </BackLink>
      <PageHeader title={title} parentHref="/tai-khoan" className="md:mt-1" />
      <div className="mt-4">{children}</div>
    </main>
  );
}

export const errText = loadErrorText;
