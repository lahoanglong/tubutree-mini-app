import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Cộng tác viên — Tubu Tree', robots: { index: false, follow: false } };

export default function CtvLayout({ children }: { children: React.ReactNode }) {
  return children;
}
