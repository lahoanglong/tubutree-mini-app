import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: 'Yêu cầu của tôi', template: '%s — Tubu Tree' }, robots: { index: false, follow: false } };

export default function RecycleRequestsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
