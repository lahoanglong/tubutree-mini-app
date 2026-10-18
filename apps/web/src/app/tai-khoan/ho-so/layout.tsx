import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sửa hồ sơ — Tubu Tree', robots: { index: false, follow: false } };

export default function EditProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
