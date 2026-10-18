import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Quản lý nhãn hàng — Tubu Tree', robots: { index: false, follow: false } };

export default function BrandOwnerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
