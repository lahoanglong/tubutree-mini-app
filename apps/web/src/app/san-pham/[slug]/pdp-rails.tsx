'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchProducts, type ProductCard as CoreProductCard } from '@tubutree/app-core/api/catalog';
import { PDP_FEED_SOURCE_LIMIT, pdpShelves } from '@tubutree/app-core/commerce/pdp-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { forYouQuery, relatedQuery } from '@tubutree/app-core/queries/catalog';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { usePdpAddOnState } from './pdp-addons';
import { PdpFeed, Rail } from './pdp-feed';

const FIVE_MIN = 5 * 60_000;
const NONE: ReadonlySet<string> = new Set();

/**
 * Dải cuối trang (khối `suggestions`): "Cùng thương hiệu" và "Có thể bạn cũng thích" (lưới), không trùng nhau và không có món đang xem. Dải "Khách thường
 * mua cùng" không nằm ở đây: nó là một nguồn của khối mua kèm duy nhất (`PdpAddOns`); khi khối đó đang vẽ dải ấy thì các món của nó không lặp ở hai dải
 * này, khi khối vẽ "Gợi ý mua kèm hợp vị" thì hai món bổ trợ của bộ không lặp (`pdpShelves`). Danh sách thương hiệu do server dựng sẵn (liên kết nội bộ
 * cho công cụ tìm kiếm); thiếu thì tải ở trình duyệt; lưới cuối chỉ tải ở trình duyệt. Giá Giờ vàng trên thẻ khớp giá thật qua `ProductCard`.
 */
export function PdpRails({
  productId,
  slug,
  brand,
  initialRelated,
}: {
  productId: string;
  slug: string;
  brand: string;
  initialRelated?: CoreProductCard[];
}) {
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
  const addOn = usePdpAddOnState();
  const shelves = pdpShelves({
    currentId: productId,
    boughtTogether: addOn?.source === 'bought' ? addOn.bought : [],
    brand: related.data ?? [],
    feed: feed ?? [],
    claimed: addOn?.source === 'fbt' ? addOn.claimed : NONE,
  });
  if (!related.isPending && shelves.brand.length === 0 && shelves.feed.length === 0) return null;
  return (
    <div data-pdp-block="suggestions">
      <Rail title={fillCopy('pdp.brandShelf')} label={fillCopy('pdp.brandShelfLabel', { brand })} products={shelves.brand} loading={related.isPending} shelf="pdpBrand" />
      <PdpFeed items={shelves.feed} />
    </div>
  );
}
