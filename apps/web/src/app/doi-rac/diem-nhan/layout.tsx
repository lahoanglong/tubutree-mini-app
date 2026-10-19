import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Chọn điểm nhận — Tubu Tree', robots: { index: false, follow: false } };

export default function RecyclePointsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
