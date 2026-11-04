import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Ví Tubu', robots: { index: false, follow: false } };

export default function WalletHistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
