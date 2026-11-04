import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: 'Ca làm của tôi', template: '%s — Tubu Tree' }, robots: { index: false, follow: false } };

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return children;
}
