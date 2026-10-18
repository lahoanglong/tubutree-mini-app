import type { Metadata } from 'next';
import { RecycleHome } from '@/components/recycle/recycle-home';

export const metadata: Metadata = { title: 'Đổi rác lấy quà — Tubu Tree', robots: { index: false, follow: false } };

export default function RecyclePage() {
  return <RecycleHome />;
}
