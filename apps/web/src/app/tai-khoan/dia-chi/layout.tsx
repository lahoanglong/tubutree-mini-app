import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sổ địa chỉ', robots: { index: false, follow: false } };

export default function AddressBookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
