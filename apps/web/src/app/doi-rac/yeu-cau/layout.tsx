import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Yêu cầu của tôi — Tubu Tree', robots: { index: false, follow: false } };

export default function RecycleRequestsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
