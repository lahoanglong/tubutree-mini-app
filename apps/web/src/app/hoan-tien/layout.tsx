import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CASHBACK_ENABLED } from '@tubutree/app-core/features';

export const metadata: Metadata = {
  title: 'Hoàn tiền — Tubu Tree',
  ...(CASHBACK_ENABLED ? {} : { robots: { index: false, follow: false } }),
};

// Lối vào đang tắt (CASHBACK_ENABLED): giống Mini App, mở thẳng thì về trang chủ.
export default function CashbackLayout({ children }: { children: React.ReactNode }) {
  if (!CASHBACK_ENABLED) redirect('/');
  return children;
}
