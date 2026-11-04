import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Vườn Xanh', robots: { index: false, follow: false } };

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return children;
}
