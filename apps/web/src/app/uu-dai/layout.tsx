import type { Metadata } from 'next';

// Ưu đãi mở cho khách chưa đăng nhập (Giờ vàng, Nhận mã) nhưng vẫn là trang của riêng khách (điểm, ví mã): không lập chỉ mục, không canonical
// (noindex kèm canonical là hai tín hiệu mâu thuẫn). Robots.txt không Disallow trang này (xem NOINDEX_PUBLIC_PATHS ở lib/site.ts) để crawler đọc được thẻ noindex.
export const metadata: Metadata = { title: 'Ưu đãi', robots: { index: false, follow: false } };

export default function OffersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
