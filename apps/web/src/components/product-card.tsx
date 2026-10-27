import Link from 'next/link';
import { type ProductCard as P, formatSold } from '@/lib/api';
import { CardSaleBadge, ProductPriceRow } from '@/components/flash-price';
import { WishlistHeart } from '@/components/catalog/wishlist-heart';
import { brandAccent } from '@/components/mini/brand-accent';
import { ThumbPlaceholder } from '@/components/thumb-placeholder';

/** Số thẻ đầu trên màn hình đầu (hai hàng trên mobile, một hàng từ md): ảnh của chúng là ứng viên LCP nên tải ngay. */
export const PRIORITY_CARDS = 4;

/**
 * `priority`: thẻ nằm trên màn hình đầu, tải ảnh ngay và ưu tiên cao thay vì chờ cuộn tới.
 *
 * Dưới md là ProductTile của Mini App (phẳng, đổ bóng elevation-1, tim nổi, chấm màu + nhãn, sao · đã bán TRÊN giá); từ md giữ thẻ viền
 * của máy tính. Cùng một cây DOM, đổi kiểu bằng class (không dựng hai bản) để HTML dựng sẵn (ISR) đúng ở cả hai khổ.
 * Tim là anh em của link (không lồng nút trong thẻ `a`).
 */
export default function ProductCard({ product, priority = false }: { product: P; priority?: boolean }) {
  // `=== false`: API cũ/nguồn không có cờ thì coi như còn hàng, không dán nhãn nhầm.
  const soldOut = product.inStock === false;
  const reviewed = (product.reviewCount ?? 0) > 0;
  const sold = formatSold(product.sold);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-card bg-stone-0 shadow-[var(--elevation-1)] md:border md:border-stone-200 md:shadow-card md:transition-all md:duration-300 md:hover:-translate-y-1 md:hover:border-forest-600/40 md:hover:shadow-raised">
      <Link href={`/san-pham/${product.slug}`} className="flex flex-1 flex-col">
        {/* Thumbnail Container */}
        <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-stone-100">
          {product.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.thumbnail}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 ease-out md:group-hover:scale-105"
              // Kích thước nội tại cho trình duyệt giữ chỗ trước khi ảnh về; CSS (h-full w-full trong khung vuông) vẫn quyết định hiển thị.
              width={400}
              height={400}
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : undefined}
              decoding="async"
            />
          ) : (
            <ThumbPlaceholder brand={product.brand} />
          )}

          {soldOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-stone-900/45">
              <span className="rounded-full bg-stone-0 px-3 py-1 text-xs font-bold text-stone-800 shadow-card">Hết hàng</span>
            </div>
          )}

          {/* Nhãn giảm giá; giá Giờ vàng được gắn nhãn riêng (giá hiển thị khớp giỏ và đơn). */}
          {!soldOut && (
            <CardSaleBadge
              product={product}
              className="absolute left-2.5 top-2.5 rounded-full bg-promo-solid px-2 py-0.5 text-xs font-bold text-stone-900 shadow-card"
            />
          )}

          {/* Máy tính: nhãn nằm trên ảnh; điện thoại có hàng chấm màu + nhãn bên dưới ảnh như Mini App. */}
          <div
            data-testid="card-brand-chip"
            className="absolute bottom-2 left-2.5 rounded-md bg-stone-0/90 px-2 py-0.5 text-xs font-semibold text-forest-800 shadow-card backdrop-blur-sm max-md:hidden"
          >
            {product.brand}
          </div>
        </div>

        {/* Info Content: flex-col + order để hàng sao đứng trên giá ở điện thoại, dưới giá ở máy tính. */}
        <div className="flex flex-1 flex-col p-2.5 md:p-3.5">
          <div data-testid="card-brand-row" className="mb-0.5 flex items-center gap-[5px] text-xs font-semibold text-[var(--color-text-secondary)] md:hidden">
            <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: brandAccent(product.brand) }} />
            {product.brand}
          </div>
          <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-medium max-md:min-h-11 max-md:leading-[22px] text-stone-900 transition-colors md:group-hover:text-forest-700">
            {product.name}
          </h3>

          <ProductPriceRow
            product={product}
            className="order-2 mt-1 flex items-baseline gap-2 md:order-1 md:mt-2"
            priceClassName="text-base font-bold text-stone-900 max-md:text-sm"
            originalClassName="text-xs text-stone-500 line-through"
          />

          {/* Sao hiện cả khi chưa có đánh giá ("★ Mới" như Mini App); số sao chỉ khi có đánh giá THẬT, không khoe ★5.0 giả. */}
          <div data-testid="card-meta" className="order-1 mt-1 flex items-center gap-1 text-xs text-stone-600 md:order-2 md:mt-auto md:justify-between md:pt-2">
            {reviewed ? (
              <span className="font-medium text-stone-700">
                <span className="text-honey-500">★</span>
                {` ${(product.ratingAvg ?? 0).toFixed(1)} (${product.reviewCount})`}
              </span>
            ) : (
              <span>★ Mới</span>
            )}
            {sold && (
              <span className="font-semibold md:font-normal">
                <span className="md:hidden">{' · '}</span>
                {sold}
              </span>
            )}
          </div>
        </div>
      </Link>
      <WishlistHeart productId={product.id} floating />
    </div>
  );
}
