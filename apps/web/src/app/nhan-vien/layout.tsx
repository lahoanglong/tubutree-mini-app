import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Ca làm của tôi — Tubu Tree', robots: { index: false, follow: false } };

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return children;
}
