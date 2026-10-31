import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import type { FlashPriceItem } from '@tubutree/app-core/flash-price';
import { pickCardFlash, productCardView, type CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import { useCatalogLaunchDate } from '../../hooks/use-catalog-launch-date';
import { useFlashExpiry } from '../../hooks/use-flash-expiry';
import { useFreeShipThreshold } from '../../hooks/use-free-ship-threshold';
import { fetchActiveFlashSales } from '../../services/shop-api';
import { serverNow } from '../../utils/server-clock';
import { WishlistHeart } from '../wishlist-heart';
import { ProductTile } from './product-tile';

export interface ProductCardProps {
  product: ProductCardData;
  variant: CardVariant;
  /** Suất Giờ vàng của nơi gọi (dải Giờ vàng đã có suất trong tay); thiếu thì chọn từ danh sách suất đang chạy, `null` là tắt Giờ vàng. */
  flash?: FlashPriceItem | null;
  rank?: number;
  inCombo?: boolean;
  showBrand?: boolean;
  note?: string;
  /** Ghi vào state điều hướng, thành `product_viewed.listSource` ở trang chi tiết. */
  listSource?: string;
  /** Mặc định có tim ở thẻ đủ rộng (grid, rail-md, rank); gian hàng xem trước tắt vì khách chưa đăng nhập vào đó. */
  showWishlist?: boolean;
  imageOverlay?: ReactNode;
  /** Nút phụ cuối thẻ (Mua lại); thiếu thì thẻ không có nút. */
  onAdd?: () => void;
  addLabel?: string;
  /** Chưa biết giá thật (Đã xem gần đây đang tải): không in giá, vẫn giữ chỗ. */
  hidePrice?: boolean;
  onOpen?: () => void;
}

const HEART_VARIANTS: ReadonlySet<CardVariant> = new Set(['grid', 'rail-md', 'rank']);

/**
 * Thẻ sản phẩm nối dữ liệu thật vào `ProductTile`: chọn suất Giờ vàng, mốc ngày mở bán và ngưỡng miễn phí giao rồi để `productCardView`
 * quyết giá, nhãn, chữ. Dùng chung khoá react-query của dải Giờ vàng và cấu hình công khai nên không phát sinh request mới.
 *
 * Nhãn chỉ hiện khi dữ kiện đã về, không hứa rồi rút: chưa biết mốc ngày mở bán thì bỏ `createdAt` (không "Mới"), chưa có cấu hình thì
 * không "Miễn phí giao hàng". Thẻ tự vẽ lại đúng mốc hết giờ của suất đang áp (`useFlashExpiry`).
 */
export function ProductCard({
  product,
  variant,
  flash: flashProp,
  rank,
  inCombo,
  showBrand,
  note,
  listSource,
  showWishlist = true,
  imageOverlay,
  onAdd,
  addLabel,
  hidePrice,
  onOpen,
}: ProductCardProps) {
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000 });
  const launchDate = useCatalogLaunchDate();
  const freeShipThreshold = useFreeShipThreshold();
  const now = serverNow();
  const flash = flashProp !== undefined ? flashProp : pickCardFlash(product, flashQ.data ?? [], now);
  useFlashExpiry(flash?.endAt);

  const view = productCardView({
    product: launchDate === undefined ? { ...product, createdAt: undefined } : product,
    flash,
    variant,
    now,
    rank,
    inCombo,
    showBrand,
    freeShipThreshold,
    launchDate: launchDate ?? null,
  });

  const variationId = view.isFlash ? flash?.variationId : undefined;
  const navState = {
    ...(listSource ? { listSource } : null),
    ...(variationId ? { variationId } : product.pinnedVariationId ? { pinnedVariationId: product.pinnedVariationId } : null),
  };

  return (
    <ProductTile
      view={view}
      variant={variant}
      href={`/product/${encodeURIComponent(product.slug)}`}
      note={note}
      onAdd={onAdd}
      addLabel={addLabel}
      hidePrice={hidePrice}
      navState={Object.keys(navState).length > 0 ? navState : undefined}
      onOpen={onOpen}
      imageOverlay={imageOverlay}
      wishlist={showWishlist && HEART_VARIANTS.has(variant) ? <WishlistHeart productId={product.id} productName={product.name} floating size={18} /> : undefined}
    />
  );
}
