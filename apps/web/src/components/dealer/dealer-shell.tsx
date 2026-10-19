import { skin } from '@/components/pro-shared/mini-skin';
import './dealer-theme.css';
import BackLink from '@/components/back-link';

/** Khung chung của kênh đại lý: mỗi nhánh render có đúng một h1. */
export function DealerShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main
      className={`mx-auto max-w-5xl px-4 py-6 max-md:min-h-dvh max-md:bg-[var(--color-dealer-bg)] ${skin.mainUp}`}
      data-dealer-theme
    >
      <BackLink href="/tai-khoan">
        ← Tài khoản
      </BackLink>
      <h1 className={`mt-1 max-md:mt-0 ${skin.pageTitle}`}>{title}</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}

export const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');
