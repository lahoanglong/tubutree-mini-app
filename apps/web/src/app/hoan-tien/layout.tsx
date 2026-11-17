import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CASHBACK_ENABLED } from '@tubutree/app-core/features';

export const metadata: Metadata = {
  title: 'Hoàn tiền',
  ...(CASHBACK_ENABLED ? {} : { robots: { index: false, follow: false } }),
};

// Lối vào đang tắt (CASHBACK_ENABLED): mở thẳng (link cũ, dấu trang) thì về Cá nhân, như Mini App (/cashback → /profile).
export default function CashbackLayout({ children }: { children: React.ReactNode }) {
  if (!CASHBACK_ENABLED) redirect('/tai-khoan');
  return children;
}
