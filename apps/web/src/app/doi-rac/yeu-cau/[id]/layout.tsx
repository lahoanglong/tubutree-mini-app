import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Yêu cầu đổi rác — Tubu Tree', robots: { index: false, follow: false } };

export default function RecycleRequestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
