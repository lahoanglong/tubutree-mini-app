import type { Metadata } from 'next';
import { fetchBrands, fetchCategories } from '@tubutree/app-core/api/catalog';
import { fetchBestSellers } from '@tubutree/app-core/api/browse';
import { shelf } from '@tubutree/app-core/merch/shelves';
import BrowseView from '@/components/catalog/browse-view';
import { createServerHttp } from '@/lib/core-http-server';
import { BUILD_GAP_REVALIDATE_S } from '@/lib/home-initial';
import { browseMetadata } from '@/lib/home-seo';
import { PAGE_WIDE } from '@/lib/page-frame';

// useSearchParams trong BrowseView trả rỗng lúc dựng nhờ force-static; trình duyệt đọc lại URL thật (utm, focus) sau hydrate.
export const dynamic = 'force-static';
export const revalidate = 300;

export const metadata: Metadata = browseMetadata({ page: 1 }, true);

const valueOf = <T,>(r: PromiseSettledResult<T>): T | undefined => (r.status === 'fulfilled' ? r.value : undefined);

const isBuild = () => process.env.NEXT_PHASE === 'phase-production-build';

/**
 * Hub /san-pham (middleware viết lại từ /san-pham khi không có tham số lọc, xem lib/browse-hub-route.ts): cùng nội dung nhánh hub của
 * app/san-pham/page.tsx nhưng là ISR, nên dựng một lần mỗi 5 phút thay vì mỗi lượt khách.
 */
export default async function BrowseHubPage() {
  const http = createServerHttp();
  const parts = await Promise.allSettled([fetchBestSellers(http, shelf('browse.bestSellers').maxItems), fetchBrands(http), fetchCategories(http)]);
  const failed = parts.find((p): p is PromiseRejectedResult => p.status === 'rejected');
  // Lúc chạy: ném để Next giữ bản đã dựng thay vì lưu hub thiếu kệ tới hết 5 phút. `next build` thường chạy khi API chưa lên: dựng thiếu,
  // rồi rút hạn làm mới (Next lấy hạn nhỏ nhất của các fetch trong lần dựng) để bản đủ dữ liệu thay vào sớm.
  if (failed && !isBuild()) throw failed.reason;
  if (failed) await createServerHttp({ revalidate: BUILD_GAP_REVALIDATE_S }).get('/config/public').catch(() => undefined);
  const [bestSellers, brands, categories] = parts;
  return (
    <main className={`${PAGE_WIDE} md:py-8`}>
      <BrowseView initial={null} bestSellers={valueOf(bestSellers)} brands={valueOf(brands)} categories={valueOf(categories)} />
    </main>
  );
}
