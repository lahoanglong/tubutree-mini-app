import { bestSellersWithBasis } from '@tubutree/app-core/api/browse';
import { HOME_BEST_SELLER_LIMIT } from '@tubutree/app-core/home-layout';
import { fetchProducts } from '../../services/shop-api';

/**
 * Query Bán chạy nhất của Trang chủ, dùng chung cho `useHomeShelves` và `BestSellerRailQuery` (cùng khoá nên dùng chung dữ liệu đã tải). Đi qua `fetchProducts`
 * (có đường tắt khối `/home`), lùi về `best_seller` khi API cũ từ chối thước đo 30 ngày và trả `basis` để kệ ghi đúng thước đo.
 */
export const homeBestSellerQuery = {
  queryKey: ['products', 'home-best-seller'] as const,
  queryFn: () => bestSellersWithBasis((sort) => fetchProducts({ limit: HOME_BEST_SELLER_LIMIT, sort })),
};
