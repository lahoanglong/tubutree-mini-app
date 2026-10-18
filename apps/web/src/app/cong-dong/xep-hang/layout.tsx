import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Bảng xếp hạng — Tubu Tree', robots: { index: false, follow: false } };

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
