import type { Metadata } from 'next';
import { AccountShell } from '@/components/account/account-shell';

export const metadata: Metadata = { title: 'Kho quà — Tubu Tree', robots: { index: false, follow: false } };

export default function RewardsLayout({ children }: { children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
