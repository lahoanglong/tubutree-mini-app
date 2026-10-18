import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sửa yêu cầu đổi rác — Tubu Tree', robots: { index: false, follow: false } };

export default function RecycleEditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
