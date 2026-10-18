import Link from 'next/link';
import { ui } from '@/lib/guest-ui';

/** Khung chung của kênh đại lý: mỗi nhánh render có đúng một h1. */
export function DealerShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/tai-khoan" className={ui.backLink}>
        ← Tài khoản
      </Link>
      <h1 className={`mt-1 ${ui.pageTitle}`}>{title}</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}

export const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');
