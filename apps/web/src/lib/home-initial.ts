import { fetchActiveFlashSales } from '@tubutree/app-core/api/flash-sale';
import { fetchBrands, fetchCategories, fetchProducts } from '@tubutree/app-core/api/catalog';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { SUGGEST_PAGE_SIZE } from '@tubutree/app-core/home-layout';
import type { HomeInitial } from '@/components/home/home-view';
import { createServerHttp } from '@/lib/core-http-server';

/** Phần phụ của trang: lỗi thì bỏ phần đó, để HomeView tự tải lại phía trình duyệt (và hiện khối lỗi + Thử lại nếu vẫn lỗi). */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/** Bản dựng sẵn thiếu dữ liệu vì API chưa lên lúc `next build`: làm mới sau ngần này giây thay vì chờ hết 5 phút. */
export const BUILD_GAP_REVALIDATE_S = 10;

/** Giờ vàng đổi theo giờ và theo số suất còn: bản dựng sẵn giữ ngắn hơn 5 phút của phần còn lại. */
export const FLASH_REVALIDATE_S = 60;

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
  const [categories, brands, publicConfig, flash] = await Promise.all([
    orUndefined(fetchCategories(http)),
    orUndefined(fetchBrands(http)),
    orUndefined(publicConfigQuery(http).queryFn()),
    orUndefined(fetchActiveFlashSales(createServerHttp({ revalidate: FLASH_REVALIDATE_S }))),
  ]);
  const [bestSellers, suggest] = grids.map((g) => (g.status === 'fulfilled' ? g.value : undefined));
  if (process.env.NEXT_PHASE === 'phase-production-build' && [bestSellers, suggest, categories, brands, publicConfig, flash].some((part) => part === undefined)) {
    // Next lấy hạn làm mới của trang từ hạn nhỏ nhất của các lệnh fetch trong lần dựng đó; lần dựng lại ở runtime có đủ dữ liệu trả hạn về 5 phút.
    await createServerHttp({ revalidate: BUILD_GAP_REVALIDATE_S }).get('/config/public').catch(() => undefined);
  }
  return { bestSellers, suggest, categories, brands, publicConfig, flash };
}
