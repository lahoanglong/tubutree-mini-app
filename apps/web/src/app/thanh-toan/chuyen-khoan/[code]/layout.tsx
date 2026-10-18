import type { Metadata } from 'next';

/** Trang riêng của khách: tiêu đề riêng và chặn lập chỉ mục như /thanh-toan (xem app/robots.ts). */
export const metadata: Metadata = { title: 'Thanh toán chuyển khoản — Tubu Tree', robots: { index: false, follow: false } };

export default function BankPaymentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
