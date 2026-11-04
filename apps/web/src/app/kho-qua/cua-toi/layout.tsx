import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Quà của tôi', robots: { index: false, follow: false } };

export default function MyRewardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
