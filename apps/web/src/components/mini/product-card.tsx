'use client';

// Nguồn: apps/miniapp/src/components/ui/product-card.tsx
import type { ReactNode } from 'react';
import { pickCardFlash, productCardView, type CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import { serverNow } from '@tubutree/app-core/server-clock';
import { WishlistHeart } from '@/components/catalog/wishlist-heart';
import type { FlashItem } from '@/lib/flash-price';
import { productHref } from '@/lib/product-href';
import type { ProductCard as ProductCardType } from '@/lib/api';
import { useCatalogLaunchDate } from '@/lib/use-catalog-launch-date';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { useFlashExpiry } from '@/lib/use-flash-expiry';
import { useFreeShipThreshold } from '@/lib/use-free-ship-threshold';
import { useHydrated } from '@/lib/use-hydrated';
import { ProductTile } from './product-tile';

/** Số thẻ đầu trên màn hình đầu (hai hàng trên mobile, một hàng từ md): ảnh của chúng là ứng viên LCP nên tải ngay. */
export const PRIORITY_CARDS = 4;

export interface ProductCardProps {
  product: ProductCardType;
  variant: CardVariant;
  /** Suất Giờ vàng của nơi gọi (dải Giờ vàng đã có suất trong tay); thiếu thì chọn từ danh sách suất đang chạy, `null` là tắt Giờ vàng. */
  flash?: FlashItem | null;
  rank?: number;
  /** Hạng không ghi số (xem `ProductTile.rankPlain`). */
  rankPlain?: boolean;
  inCombo?: boolean;
  showBrand?: boolean;
  note?: string;
  /** Thẻ nằm trên màn hình đầu: tải ảnh ngay thay vì chờ cuộn tới (`PRIORITY_CARDS` thẻ đầu). */
  priority?: boolean;
  /** Mặc định có tim ở thẻ đủ rộng (grid, rail-md, rank); gian hàng xem trước tắt vì khách chưa đăng nhập vào đó. */
  showWishlist?: boolean;
  /** Nút nổi trên ảnh (giỏ nhanh); hết hàng thì không vẽ. */
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
 * quyết giá, nhãn, chữ. Dùng chung kho Giờ vàng và khoá cấu hình công khai nên không phát sinh request mới.
 *
 * HTML dựng sẵn (ISR) và lần hydrate đầu phải khớp nhau: trước `useHydrated()` không có nhãn theo giờ máy khách ("Mới", "Miễn phí giao
 * hàng"); kho Giờ vàng ở máy chủ rỗng nên giá cũng là giá thường. Sau đó nhãn chỉ hiện khi dữ kiện đã về, không hứa rồi rút. Thẻ tự vẽ lại
 * đúng mốc hết giờ của suất đang áp (`useFlashExpiry`).
 */
export function ProductCard({
  product,
  variant,
  flash: flashProp,
  rank,
  rankPlain,
  inCombo,
  showBrand,
  note,
  priority,
  showWishlist = true,
  imageOverlay,
  onAdd,
  addLabel,
  hidePrice,
  onOpen,
}: ProductCardProps) {
  const hydrated = useHydrated();
  const activeFlash = useActiveFlashSales();
  const launchDate = useCatalogLaunchDate();
  const freeShip = useFreeShipThreshold();
  const now = serverNow();
  const flash = flashProp !== undefined ? flashProp : pickCardFlash(product, activeFlash, now);
  useFlashExpiry(flash?.endAt);

  const knownLaunch = hydrated && launchDate !== undefined;
  const view = productCardView({
    product: knownLaunch ? product : { ...product, createdAt: undefined },
    flash,
    variant,
    now,
    rank,
    inCombo,
    showBrand,
    freeShipThreshold: hydrated ? freeShip : null,
    launchDate: knownLaunch ? launchDate : null,
  });

  return (
    <ProductTile
      view={view}
      variant={variant}
      href={productHref(product.slug, view.isFlash ? flash?.variationId : undefined, product.pinnedVariationId)}
      note={note}
      rankPlain={rankPlain}
      priority={priority}
      onAdd={onAdd}
      addLabel={addLabel}
      hidePrice={hidePrice}
      onOpen={onOpen}
      imageOverlay={view.stock === 'out' ? undefined : imageOverlay}
      wishlist={showWishlist && HEART_VARIANTS.has(variant) ? <WishlistHeart productId={product.id} productName={product.name} floating /> : undefined}
    />
  );
}

export default ProductCard;
