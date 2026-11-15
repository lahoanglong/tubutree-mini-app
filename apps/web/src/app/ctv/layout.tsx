import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: 'Cộng tác viên', template: '%s — Tubu Tree' } };

export default function CtvLayout({ children }: { children: React.ReactNode }) {
  return children;
}
