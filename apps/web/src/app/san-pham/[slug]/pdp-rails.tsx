'use client';

import { useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { fetchProducts, type ProductCard as CoreProductCard } from '@tubutree/app-core/api/catalog';
import { PDP_FEED_SOURCE_LIMIT, pdpShelves } from '@tubutree/app-core/commerce/pdp-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { boughtTogetherQuery, forYouQuery, relatedQuery } from '@tubutree/app-core/queries/catalog';
import { ProductRail } from '@/components/mini/product-rail';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { PdpFeed } from './pdp-feed';
import { pdpSectionTitle } from './pdp-sections';

const FIVE_MIN = 5 * 60_000;

/** `label` là tên đọc của dải khi khác tiêu đề nhìn thấy (dải thương hiệu: tiêu đề bỏ tên, nhãn đọc giữ tên). */
function Rail({ title, label = title, icon, products, loading }: { title: string; label?: string; icon?: boolean; products: CoreProductCard[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <section aria-busy="true" className="mt-8 max-md:mt-4">
        <Skeleton width={160} height={20} />
        <div className="mt-3">
          <ProductRail items={[]} variant="rail-md" label={label} loading skeletonCount={4} />
        </div>
      </section>
    );
  }
  // Dải phụ: lỗi hoặc rỗng thì ẩn hẳn, như Mini App; trang vẫn đủ nội dung chính.
  if (!products || products.length === 0) return null;
  return (
    <section className="mt-8 max-md:mt-4">
      <h2 className={`${pdpSectionTitle} flex items-center gap-1.5`}>
        {icon && <ShoppingCart className="h-5 w-5" aria-hidden="true" />}
        {title}
      </h2>
      <div className="mt-3">
        <ProductRail items={products} variant="rail-md" label={label} />
      </div>
    </section>
  );
}

/**
 * "Khách thường mua cùng", "Cùng thương hiệu" và "Có thể bạn cũng thích" (lưới cuối trang), không trùng nhau và không có món đang xem
 * (`pdpShelves`: trần và sàn lấy từ SHELVES). Danh sách đầu do server dựng sẵn (liên kết nội bộ cho công cụ tìm kiếm); thiếu thì tải ở
 * trình duyệt; lưới cuối chỉ tải ở trình duyệt. Giá Giờ vàng trên thẻ khớp giá thật qua `ProductCard`.
 */
export function PdpRails({
  productId,
  slug,
  brand,
  initialRelated,
  initialBoughtTogether,
}: {
  productId: string;
  slug: string;
  brand: string;
  initialRelated?: CoreProductCard[];
  initialBoughtTogether?: CoreProductCard[];
}) {
  const together = useQuery({ ...boughtTogetherQuery(coreHttp, slug), initialData: initialBoughtTogether, staleTime: FIVE_MIN, retry: 0 });
  const related = useQuery({ ...relatedQuery(coreHttp, slug), initialData: initialRelated, staleTime: FIVE_MIN, retry: 0 });
  // `/products/for-you` cần đăng nhập: khách vãng lai (phần lớn lượt vào trang SEO này) gọi sẽ nhận 401 mỗi lần xem. Họ xem bán chạy
  // (nguồn công khai); đang khôi phục phiên thì chờ, chưa gọi nguồn nào.
  const phase = useAuthPhase();
  const personal = useQuery({ ...forYouQuery(coreHttp), enabled: phase === 'authenticated', staleTime: FIVE_MIN, retry: 0 });
  const popular = useQuery({
    queryKey: ['products', 'pdp-popular'],
    queryFn: () => fetchProducts(coreHttp, { limit: PDP_FEED_SOURCE_LIMIT, sort: 'best_seller' }),
    enabled: phase !== 'authenticated' && phase !== 'loading',
    staleTime: FIVE_MIN,
    retry: 0,
  });
  const feed = phase === 'authenticated' ? personal.data : popular.data?.data;
  const shelves = pdpShelves({ currentId: productId, boughtTogether: together.data ?? [], brand: related.data ?? [], feed: feed ?? [] });
  return (
    <>
      <Rail title={fillCopy('pdp.boughtTogether')} icon products={shelves.boughtTogether} loading={together.isPending} />
      <Rail title={fillCopy('pdp.brandShelf')} label={fillCopy('pdp.brandShelfLabel', { brand })} products={shelves.brand} loading={related.isPending} />
      <PdpFeed items={shelves.feed} />
    </>
  );
}
