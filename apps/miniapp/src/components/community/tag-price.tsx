import { flashRefetchInterval } from '@tubutree/app-core/queries/flash-sale';
import { useQuery } from '@tanstack/react-query';
import { fetchActiveFlashSales } from '../../services/shop-api';
import { formatVnd } from '../../utils/format';
import { Text } from '../ui/text';
import { tilePricing } from '../catalog/catalog-pricing';

/** Giá của sản phẩm gắn trong bài: giá khách trả trên thẻ sản phẩm (gồm Giờ vàng), cùng quy tắc với gợi ý tìm. */
export function TagPrice({ product, variant }: { product: { slug: string; basePrice: number; salePrice?: number | null }; variant: 'label' | 'price-sm' }) {
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000, refetchInterval: flashRefetchInterval });
  const pricing = tilePricing(product, flashQ.data ?? []);
  return (
    <Text variant={variant} tone="brand" as="div">
      {formatVnd(pricing.price)}
    </Text>
  );
}
