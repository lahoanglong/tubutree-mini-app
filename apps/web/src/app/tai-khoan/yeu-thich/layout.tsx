import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sản phẩm yêu thích — Tubu Tree', robots: { index: false, follow: false } };

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
