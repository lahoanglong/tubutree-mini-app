import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tạo yêu cầu đổi rác — Tubu Tree', robots: { index: false, follow: false } };

export default function RecycleNewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
