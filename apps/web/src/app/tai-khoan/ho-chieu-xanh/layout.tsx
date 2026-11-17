import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Hộ chiếu Xanh', robots: { index: false, follow: false } };

export default function EcoPassportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
