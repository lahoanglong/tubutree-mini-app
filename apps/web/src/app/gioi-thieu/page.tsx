import type { Metadata } from 'next';
import { fetchFaqs, fetchSupportContact, getPublicConfig } from '@tubutree/app-core/api/config';
import { createServerHttp } from '@/lib/core-http-server';
import { fallbackFaq } from '@/lib/faq-fallback';
import { staticPageJsonLd, staticPageMetadata } from '@/lib/page-seo';
import { jsonLdScript } from '@/lib/product-seo';
import { JsonLd } from '@/components/seo/json-ld';
import { AboutView } from './about-view';

export const revalidate = 3600;

const SEO = {
  path: '/gioi-thieu',
  title: 'Về Tubu Tree',
  description: 'Tubu Tree kết nối bạn với các thương hiệu Việt tử tế: câu hỏi thường gặp, liên hệ hỗ trợ và chính sách mua sắm.',
};

export const metadata: Metadata = staticPageMetadata(SEO);

export default async function AboutPage() {
  const http = createServerHttp({ revalidate });
  // Lỗi đọc thì bỏ qua: client tự tải và rơi về bản FAQ dự phòng như trước, trang ISR không bị lưu rỗng vì lỗi tạm.
  const [faqs, config, support] = await Promise.all([
    fetchFaqs(http).catch(() => undefined),
    getPublicConfig(http).catch(() => undefined),
    fetchSupportContact(http).catch(() => undefined),
  ]);
  // Cùng nguồn và cùng bản dự phòng với FaqSection (admin chưa nhập dòng nào thì dùng fallbackFaq). Chưa đọc được (undefined) thì client mới tải,
  // HTML chưa có câu hỏi nào: không khai FAQPage cho nội dung không hiển thị.
  const faqItems = faqs ? (faqs.length > 0 ? faqs : fallbackFaq(config)) : [];
  return (
    <>
      <AboutView initialFaqs={faqs} initialConfig={config} initialSupport={support} />
      <JsonLd data={staticPageJsonLd(SEO)} />
      {faqItems.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: faqItems.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
            }),
          }}
        />
      )}
    </>
  );
}
