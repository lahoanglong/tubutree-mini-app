import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Lịch sử Điểm Xanh — Tubu Tree', robots: { index: false, follow: false } };

export default function PointsHistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
