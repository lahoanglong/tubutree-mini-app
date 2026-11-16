import type { Metadata } from 'next';
import { PRIVATE_CHILD_SEO } from '@/lib/landing-seo';

export const metadata: Metadata = { title: 'Quà của tôi', robots: { index: false, follow: false }, ...PRIVATE_CHILD_SEO };

export default function MyRewardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
