import type { Metadata } from 'next';
import { CASHBACK_ENABLED } from '@tubutree/app-core/features';

// Lối vào đang tắt (CASHBACK_ENABLED): trang vẫn chạy nếu mở thẳng nhưng không đưa lên công cụ tìm kiếm.
export const metadata: Metadata = {
  title: 'Hoàn tiền — Tubu Tree',
  ...(CASHBACK_ENABLED ? {} : { robots: { index: false, follow: false } }),
};

export default function CashbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
