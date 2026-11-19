import type { Metadata } from 'next';
import { RecycleHome } from '@/components/recycle/recycle-home';
import { RecycleFaq } from '@/components/recycle/recycle-faq';
import { RecyclePageFooter } from '@/components/recycle/recycle-page-footer';
import { JsonLd } from '@/components/seo/json-ld';
import { createServerHttp } from '@/lib/core-http-server';
import { landingJsonLd, landingMetadata } from '@/lib/landing-seo';
import { faqPageJsonLd } from '@/lib/page-seo';
import { loadRecycleFaq } from '@/lib/recycle-faq';

// Câu hỏi thường gặp đọc cờ cách giao, giờ kho và danh mục món thật: làm mới 5 phút như thể lệ (/doi-rac/quy-dinh).
export const revalidate = 300;

// Khai ở page, không ở layout: /doi-rac không có layout, và các trang con (/doi-rac/tao, /yeu-cau…) tự có layout noindex của riêng chúng.
export const metadata: Metadata = landingMetadata('recycle');

export default async function RecyclePage() {
  const faq = await loadRecycleFaq(createServerHttp({ revalidate }));
  return (
    <>
      <RecyclePageFooter footer={faq.length > 0 ? <RecycleFaq items={faq} /> : null}>
        <RecycleHome />
      </RecyclePageFooter>
      <JsonLd data={landingJsonLd('recycle')} />
      {/* Cùng mảng với phần hiển thị: không có câu nào (chương trình tắt, chưa đọc được cấu hình) thì không khai FAQPage. */}
      {faq.length > 0 && <JsonLd data={faqPageJsonLd(faq)} />}
    </>
  );
}
