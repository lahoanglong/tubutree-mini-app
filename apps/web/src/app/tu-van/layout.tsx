import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Trợ lý AI Tubu — Tubu Tree', robots: { index: false, follow: false } };

export default function AdvisorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
