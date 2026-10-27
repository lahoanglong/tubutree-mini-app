import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { AccountShell } from '@/components/account/account-shell';
import { SessionCookieProvider } from '@/components/account/session-cookie-provider';
import { SESSION_COOKIE } from '@/lib/home-restore-hint';

export const metadata: Metadata = { title: 'Kho quà — Tubu Tree', robots: { index: false, follow: false } };

export default async function RewardsLayout({ children }: { children: React.ReactNode }) {
  // Cookie phiên cho SSR dựng sẵn khung hai cột của khách đã đăng nhập (không nhảy 264px khi hydrate); khách vãng lai không có cookie nên không thấy khung.
  const hasSession = (await cookies()).get(SESSION_COOKIE)?.value === '1';
  return (
    <SessionCookieProvider hasSession={hasSession}>
      <AccountShell>{children}</AccountShell>
    </SessionCookieProvider>
  );
}
