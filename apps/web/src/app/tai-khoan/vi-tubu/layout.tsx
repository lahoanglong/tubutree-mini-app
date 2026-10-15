import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Ví Tubu — Tubu Tree', robots: { index: false, follow: false } };

export default function WalletHistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
