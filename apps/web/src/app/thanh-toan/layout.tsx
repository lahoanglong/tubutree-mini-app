import type { Metadata } from 'next';

/** Trang riêng của khách: tiêu đề riêng cho tab/lịch sử, và chặn lập chỉ mục như /tai-khoan (xem app/robots.ts). */
export const metadata: Metadata = { title: 'Thanh toán — Tubu Tree', robots: { index: false, follow: false } };

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
