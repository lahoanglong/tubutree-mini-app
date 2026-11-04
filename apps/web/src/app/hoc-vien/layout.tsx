import type { Metadata } from 'next';

const description = 'Khoá học đào tạo kỹ năng bán hàng dành cho CTV của Tubu Tree.';

export const metadata: Metadata = {
  title: 'Học viện',
  description,
  robots: { index: false },
  // Trang noindex: không khai canonical/og:url (tín hiệu mâu thuẫn).
};

export default function AcademyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
