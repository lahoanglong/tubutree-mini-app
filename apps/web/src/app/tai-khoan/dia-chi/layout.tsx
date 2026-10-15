import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sổ địa chỉ — Tubu Tree', robots: { index: false, follow: false } };

export default function AddressBookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
