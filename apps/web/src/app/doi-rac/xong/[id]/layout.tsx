import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Kết quả đổi rác', robots: { index: false, follow: false } };

export default function RecycleDoneLayout({ children }: { children: React.ReactNode }) {
  return children;
}
