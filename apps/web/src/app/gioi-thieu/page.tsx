import type { Metadata } from 'next';
import { AboutView } from './about-view';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Về Tubu Tree — Tubu Tree',
  description: 'Tubu Tree kết nối bạn với các thương hiệu Việt tử tế: câu hỏi thường gặp, liên hệ hỗ trợ và chính sách mua sắm.',
  alternates: { canonical: '/gioi-thieu' },
};

export default function AboutPage() {
  return <AboutView />;
}
