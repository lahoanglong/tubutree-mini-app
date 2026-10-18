import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Lương của tôi — Tubu Tree', robots: { index: false, follow: false } };

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return children;
}
