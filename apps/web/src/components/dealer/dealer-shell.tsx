import { skin } from '@/components/pro-shared/mini-skin';
import BackLink from '@/components/back-link';

/** Bộ màu B2B của Mini App (css/dealer-theme.css); web chỉ dùng trong khung đại lý. */
const DEALER_THEME = {
  '--color-dealer-ink': '#1f2a44',
  '--color-dealer-ink-soft': '#2e3b5e',
  '--color-dealer-bg': '#f4f6f9',
} as React.CSSProperties;

/** Khung chung của kênh đại lý: mỗi nhánh render có đúng một h1. */
export function DealerShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main
      className="mx-auto max-w-5xl px-4 py-6 max-md:min-h-dvh max-md:bg-[var(--color-dealer-bg)]"
      style={DEALER_THEME}
    >
      <BackLink href="/tai-khoan">
        ← Tài khoản
      </BackLink>
      <h1 className={`mt-1 ${skin.pageTitle}`}>{title}</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}

export const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');
