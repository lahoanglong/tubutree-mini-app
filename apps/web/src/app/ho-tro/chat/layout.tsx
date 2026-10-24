import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Chat với Tubu Tree — Tubu Tree', robots: { index: false, follow: false } };

export default function SupportChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
