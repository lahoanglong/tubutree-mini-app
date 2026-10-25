import { fetchBrands, fetchCategories, fetchProducts } from '@tubutree/app-core/api/catalog';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { SUGGEST_PAGE_SIZE } from '@tubutree/app-core/home-layout';
import type { HomeInitial } from '@/components/home/home-view';
import { createServerHttp } from '@/lib/core-http-server';

/** Phần phụ của trang: lỗi thì bỏ phần đó, để HomeView tự tải lại phía trình duyệt (và hiện khối lỗi + Thử lại nếu vẫn lỗi). */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/** Dữ liệu công khai của Trang chủ cho trang ISR (bản thường và bản khôi phục phiên dùng chung). */
export async function loadHomeInitial(): Promise<HomeInitial> {
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
  return { bestSellers, suggest, categories, brands };
}
