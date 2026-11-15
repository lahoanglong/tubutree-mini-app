import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Vườn Xanh' };

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return children;
}
