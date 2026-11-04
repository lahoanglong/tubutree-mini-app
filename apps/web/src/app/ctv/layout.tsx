import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: 'Cộng tác viên', template: '%s — Tubu Tree' }, robots: { index: false, follow: false } };

export default function CtvLayout({ children }: { children: React.ReactNode }) {
  return children;
}
