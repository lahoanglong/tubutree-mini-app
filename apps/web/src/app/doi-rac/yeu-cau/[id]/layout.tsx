import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: 'Yêu cầu đổi rác', template: '%s — Tubu Tree' }, robots: { index: false, follow: false } };

export default function RecycleRequestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
