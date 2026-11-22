import { cache } from 'react';
import type { Metadata } from 'next';
import { ChevronDown } from 'lucide-react';
import {
  fetchRefillLanding,
  REFILL_LANDING_PATH,
  refillLandingCopy,
  refillLandingFaq,
  refillLandingItems,
  refillLandingRows,
  type RefillLandingDTO,
} from '@tubutree/app-core/refill/refill-landing';
import { skin } from '@/components/pro-shared/mini-skin';
import { JsonLd } from '@/components/seo/json-ld';
import { createServerHttp } from '@/lib/core-http-server';
import { BUILD_GAP_REVALIDATE_S } from '@/lib/home-initial';
import { PAGE_WIDE } from '@/lib/page-frame';
import { faqPageJsonLd } from '@/lib/page-seo';
import { browseCollectionJsonLd, withBrowseSocial } from '@/lib/seo/browse-structured-data';
import RefillLandingView from './refill-landing-view';

export const revalidate = 300;

const TITLE = refillLandingCopy('title');

const isBuild = () => process.env.NEXT_PHASE === 'phase-production-build';

/**
 * Một lần đọc cho cả metadata và trang. Lúc chạy lỗi thì ném để Next giữ bản đã dựng. `next build` thường chạy khi API chưa lên: dựng không dữ liệu (view tự tải ở
 * trình duyệt, trang noindex, không khai danh sách) rồi rút hạn làm mới để bản đủ dữ liệu thay vào sớm (như /bo-qua-tang).
 */
const loadLanding = cache(async (): Promise<{ data?: RefillLandingDTO; fetchedAt: number }> => {
  try {
    const data = await fetchRefillLanding(createServerHttp());
    return { data, fetchedAt: Date.now() };
  } catch (e) {
    if (!isBuild()) throw e;
    await createServerHttp({ revalidate: BUILD_GAP_REVALIDATE_S }).get('/config/public').catch(() => undefined);
    return { fetchedAt: Date.now() };
  }
});

/** Mô tả không ghi số: số tiết kiệm đổi theo giá. Cờ tắt hay chưa có gói nào bán được thì trang chỉ còn lời trống nên noindex (sitemap cũng không nộp). */
function pageMetadata(indexed: boolean): Metadata {
  return withBrowseSocial({
    title: TITLE,
    description: refillLandingCopy('metaDescription'),
    alternates: { canonical: REFILL_LANDING_PATH.web },
    ...(indexed ? {} : { robots: { index: false, follow: true } }),
  });
}

export async function generateMetadata(): Promise<Metadata> {
  const { data } = await loadLanding();
  return pageMetadata(refillLandingRows(data).length > 0);
}

/** Câu hỏi thường gặp dựng ở máy chủ bằng `<details>` (không thêm JS), cùng mảng với FAQPage; cùng hàng gọn với FAQ trang Đổi rác. */
function RefillLandingFaq({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <section aria-labelledby="refill-faq-title" className="mt-6 space-y-2" data-testid="refill-landing-faq">
      <h2 id="refill-faq-title" className={skin.sectionTitle}>
        {refillLandingCopy('faqTitle')}
      </h2>
      <div className={`px-4 ${skin.card}`}>
        {items.map((f, i) => (
          <details key={f.q} className={`group${i < items.length - 1 ? ' border-b border-stone-200' : ''}`}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 py-3 text-left [&::-webkit-details-marker]:hidden">
              <span className="flex-1 text-sm font-semibold text-stone-900">{f.q}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-stone-500 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <p className="pb-3 text-sm text-stone-700">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export default async function RefillLandingPage() {
  const { data, fetchedAt } = await loadLanding();
  const rows = refillLandingRows(data);
  const faq = refillLandingFaq();
  const ld = rows.length > 0 ? browseCollectionJsonLd(pageMetadata(true), [{ name: 'Trang chủ', href: '/' }, { name: TITLE }], refillLandingItems(rows)) : null;
  return (
    <main className={`${PAGE_WIDE} py-6`}>
      {ld && <JsonLd data={ld} />}
      {rows.length > 0 && <JsonLd data={faqPageJsonLd(faq)} />}
      <RefillLandingView initial={data} initialFetchedAt={fetchedAt} />
      {rows.length > 0 && <RefillLandingFaq items={faq} />}
    </main>
  );
}
