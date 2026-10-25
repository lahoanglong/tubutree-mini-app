import type { Metadata } from 'next';
import { fetchBrands, fetchCategories, fetchProducts } from '@tubutree/app-core/api/catalog';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { SUGGEST_PAGE_SIZE } from '@tubutree/app-core/home-layout';
import HomeView from '@/components/home/home-view';
import { createServerHttp } from '@/lib/core-http-server';
import { homeText } from '@/lib/home-text';

export const revalidate = 300;

// Danh mục và tìm kiếm đã sang /san-pham (link cũ /?q|category|brand được chuyển hướng 307 ở next.config): trang chủ luôn là chính nó.
export const metadata: Metadata = { alternates: { canonical: '/' } };

/** Phần phụ của trang: lỗi thì bỏ phần đó, để HomeView tự tải lại phía trình duyệt (và hiện khối lỗi + Thử lại nếu vẫn lỗi). */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/**
 * Trang chủ như Mini App. Phần công khai (bán chạy, trang đầu lưới gợi ý, danh mục, thương hiệu) render phía server để có trong HTML
 * cho công cụ tìm kiếm; phần cá nhân hoá (thẻ thành viên, Việc cần làm, Mua lại, Quà khách mới...) render ở client sau đăng nhập.
 */
export default async function HomePage() {
  const http = createServerHttp();
  const grids = await Promise.allSettled([
    homeBestSellerQuery(http).queryFn(),
    fetchProducts(http, { limit: SUGGEST_PAGE_SIZE, page: 1 }),
  ]);
  // API sập hẳn lúc Next dựng lại trang: ném để Next giữ bản đã render thay vì lưu trang không có sản phẩm tới hết 5 phút
  // (cùng hành vi getListOrEmptyAtBuild). Riêng `next build` thường chạy khi API chưa lên: không ném, client tự tải lại.
  const failed = grids.find((g): g is PromiseRejectedResult => g.status === 'rejected');
  if (failed && grids.every((g) => g.status === 'rejected') && process.env.NEXT_PHASE !== 'phase-production-build') throw failed.reason;
  const [categories, brands] = await Promise.all([orUndefined(fetchCategories(http)), orUndefined(fetchBrands(http))]);
  const [bestSellers, suggest] = grids.map((g) => (g.status === 'fulfilled' ? g.value : undefined));

  return (
    <main className="mx-auto max-w-6xl px-4 py-4 max-md:py-0 md:py-6">
      <h1 className="sr-only font-display">Tubu Tree — {homeText.seoTitle}</h1>
      <HomeView initial={{ bestSellers, suggest, categories, brands }} />
    </main>
  );
}
