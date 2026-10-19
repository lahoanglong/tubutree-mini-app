import type { Metadata } from 'next';
import { fetchFaqs, fetchSupportContact, getPublicConfig } from '@tubutree/app-core/api/config';
import { createServerHttp } from '@/lib/core-http-server';
import { AboutView } from './about-view';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Về Tubu Tree — Tubu Tree',
  description: 'Tubu Tree kết nối bạn với các thương hiệu Việt tử tế: câu hỏi thường gặp, liên hệ hỗ trợ và chính sách mua sắm.',
  alternates: { canonical: '/gioi-thieu' },
};

export default async function AboutPage() {
  const http = createServerHttp({ revalidate });
  // Lỗi đọc thì bỏ qua: client tự tải và rơi về bản FAQ dự phòng như trước, trang ISR không bị lưu rỗng vì lỗi tạm.
  const [faqs, config, support] = await Promise.all([
    fetchFaqs(http).catch(() => undefined),
    getPublicConfig(http).catch(() => undefined),
    fetchSupportContact(http).catch(() => undefined),
  ]);
  return <AboutView initialFaqs={faqs} initialConfig={config} initialSupport={support} />;
}
