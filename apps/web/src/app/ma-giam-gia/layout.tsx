import type { Metadata } from 'next';

// Như /uu-dai: trang của riêng khách (ví mã, lịch sử dùng) nên không lập chỉ mục. Không canonical: noindex kèm canonical là hai tín hiệu mâu thuẫn.
export const metadata: Metadata = { title: 'Mã giảm giá — Tubu Tree', robots: { index: false, follow: false } };

export default function VouchersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
