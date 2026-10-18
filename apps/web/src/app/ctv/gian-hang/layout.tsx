import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Gian hàng của tôi — Tubu Tree', robots: { index: false, follow: false } };

export default function CtvStorefrontLayout({ children }: { children: React.ReactNode }) {
  return children;
}
