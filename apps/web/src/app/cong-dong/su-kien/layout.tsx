import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sự kiện — Tubu Tree', robots: { index: false, follow: false } };

export default function CommunityEventsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
