import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Cài đặt — Tubu Tree', robots: { index: false, follow: false } };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
