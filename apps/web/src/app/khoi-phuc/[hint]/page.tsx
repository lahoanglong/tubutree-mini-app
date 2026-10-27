import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import HomeView from '@/components/home/home-view';
import { HOME_HINT_SLUGS, hintOfSlug, type HomeHintSlug } from '@/lib/home-restore-hint';
import { loadHomeInitial } from '@/lib/home-initial';
import { homeText } from '@/lib/home-text';
import { PAGE_WIDE } from '@/lib/page-frame';

export const revalidate = 300;
export const dynamicParams = false;

// Chỉ middleware chuyển khách có cookie phiên tới đây (URL trình duyệt vẫn là "/"); không để công cụ tìm kiếm lập chỉ mục bản này.
export const metadata: Metadata = { alternates: { canonical: '/' }, robots: { index: false, follow: false } };

export const generateStaticParams = () => HOME_HINT_SLUGS.map((hint) => ({ hint }));

/**
 * Trang chủ cho khách ĐÃ CÓ phiên (cookie `tubu_web_session`) nhưng chưa khôi phục xong: cùng dữ liệu công khai với app/page.tsx, nhưng
 * HTML đầu dựng sẵn thứ tự khối và khung chờ của loại khách đã nhớ (thẻ thành viên, Việc cần làm, Mua lại), đúng như lần render đầu của trình
 * duyệt, nên Danh mục không nhảy khi JS tải xong và phiên khôi phục xong. Vẫn là ISR tĩnh, một bản cho mỗi gợi ý.
 */
export default async function RestoringHomePage({ params }: { params: Promise<{ hint: string }> }) {
  const { hint } = await params;
  if (!(HOME_HINT_SLUGS as readonly string[]).includes(hint)) notFound();
  const initial = await loadHomeInitial();
  return (
    <main className={`${PAGE_WIDE} py-4 max-md:py-0 md:py-6`}>
      <h1 className="sr-only font-display">Tubu Tree — {homeText.seoTitle}</h1>
      <HomeView initial={initial} restoreHint={hintOfSlug(hint as HomeHintSlug)} />
    </main>
  );
}
