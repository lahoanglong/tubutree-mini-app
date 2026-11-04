import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Hạng thành viên & Điểm Xanh', robots: { index: false, follow: false } };

export default function LoyaltyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
