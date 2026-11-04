import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Ca làm của tôi', robots: { index: false, follow: false } };

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return children;
}
