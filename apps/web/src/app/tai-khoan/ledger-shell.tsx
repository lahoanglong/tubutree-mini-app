import BackLink from '@/components/back-link';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_NARROW, PAGE_WIDE } from '@/lib/page-frame';

/** Khung chung của các trang sổ cái trong tài khoản (Điểm Xanh, Ví Tubu). */
export function LedgerShell({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <main className={`${wide ? PAGE_WIDE : PAGE_NARROW} py-6 max-md:pt-0`}>
      <BackLink href="/tai-khoan">
        ← Tài khoản
      </BackLink>
      <PageHeader title={title} parentHref="/tai-khoan" className="md:mt-1" />
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
