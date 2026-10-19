import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Bài viết cộng đồng — Tubu Tree', robots: { index: false, follow: false } };

export default function PostDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
