import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Nhận hàng tại điểm — Tubu Tree', robots: { index: false, follow: false } };

export default function RecycleDeskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
