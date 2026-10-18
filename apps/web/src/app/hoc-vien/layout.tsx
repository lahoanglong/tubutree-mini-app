import type { Metadata } from 'next';

const description = 'Khoá học đào tạo kỹ năng bán hàng dành cho CTV của Tubu Tree.';

export const metadata: Metadata = {
  title: 'Học viện — Tubu Tree',
  description,
  robots: { index: false },
  alternates: { canonical: '/hoc-vien' },
  openGraph: { type: 'website', siteName: 'Tubu Tree', locale: 'vi_VN', url: '/hoc-vien', title: 'Học viện — Tubu Tree', description },
};

export default function AcademyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
