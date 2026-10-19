import { ui } from '@/lib/guest-ui';
import BackLink from '@/components/back-link';
import { MiniTitleBar, miniTitle } from '@/components/loyalty/mini-surface';

/** Khung chung của các trang sổ cái trong tài khoản (Điểm Xanh, Ví Tubu). */
export function LedgerShell({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <main data-page-bleed className={`mx-auto px-4 py-6 max-md:pt-0 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
      <BackLink href="/tai-khoan">
        ← Tài khoản
      </BackLink>
      <MiniTitleBar>
        <h1 className={`mt-1 max-md:mt-0 ${ui.pageTitle} ${miniTitle}`}>{title}</h1>
      </MiniTitleBar>
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
