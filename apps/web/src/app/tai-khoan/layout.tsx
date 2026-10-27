import type { Metadata } from 'next';
import { AccountShell } from '@/components/account/account-shell';

/**
 * Trang nội bộ/riêng tư — chặn lập chỉ mục ở cả hai lớp: robots.txt (xem app/robots.ts) và thẻ
 * meta này, vì robots.txt chỉ ngăn thu thập chứ không ngăn URL đã biết lọt vào kết quả tìm kiếm.
 */
export const metadata: Metadata = { title: 'Tài khoản — Tubu Tree', robots: { index: false, follow: false } };

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
