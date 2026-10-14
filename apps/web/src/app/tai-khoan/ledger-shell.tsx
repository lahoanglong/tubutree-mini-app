import Link from 'next/link';
import { ui } from '@/lib/guest-ui';

/** Khung chung của các trang sổ cái trong tài khoản (Điểm Xanh, Ví Tubu). */
export function LedgerShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/tai-khoan" className={ui.backLink}>
        ← Tài khoản
      </Link>
      <h1 className={`mt-1 ${ui.pageTitle}`}>{title}</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}

/** Một dòng số tiền/số điểm có dấu: dấu trừ typographic (−) cho khoản ra, + cho khoản vào. */
export function SignedAmount({ delta, text }: { delta: number; text: string }) {
  return (
    <span className={`font-semibold tabular-nums ${delta > 0 ? 'text-success-fg' : 'text-stone-900'}`}>
      {delta > 0 ? '+' : '−'}
      {text}
    </span>
  );
}
