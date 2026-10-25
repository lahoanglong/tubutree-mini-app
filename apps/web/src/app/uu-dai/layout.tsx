import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Ưu đãi — Tubu Tree', robots: { index: false, follow: false } };

export default function OffersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
