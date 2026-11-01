import type { Metadata } from 'next';

// Ưu đãi mở cho khách chưa đăng nhập (Giờ vàng, Nhận mã) nhưng vẫn là trang của riêng khách (điểm, ví mã): không lập chỉ mục, không canonical
// (noindex kèm canonical là hai tín hiệu mâu thuẫn). Robots vẫn Disallow, xem NOINDEX_PUBLIC_PATHS ở lib/site.ts.
export const metadata: Metadata = { title: 'Ưu đãi — Tubu Tree', robots: { index: false, follow: false } };

export default function OffersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
