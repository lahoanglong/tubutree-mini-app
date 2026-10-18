import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Thông báo — Tubu Tree', robots: { index: false, follow: false } };

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
