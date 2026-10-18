import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Kho quà — Tubu Tree', robots: { index: false, follow: false } };

export default function RewardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
