import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Hạng thành viên & Điểm Xanh — Tubu Tree', robots: { index: false, follow: false } };

export default function LoyaltyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
