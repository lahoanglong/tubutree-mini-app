import Link from 'next/link';
import { type ProductCard as P, formatSold } from '@/lib/api';
import { CardSaleBadge, ProductPriceRow } from '@/components/flash-price';

/** Số thẻ đầu trên màn hình đầu (hai hàng trên mobile, một hàng từ md): ảnh của chúng là ứng viên LCP nên tải ngay. */
export const PRIORITY_CARDS = 4;

/** `priority`: thẻ nằm trên màn hình đầu, tải ảnh ngay và ưu tiên cao thay vì chờ cuộn tới. */
export default function ProductCard({ product, priority = false }: { product: P; priority?: boolean }) {
  // `=== false`: API cũ/nguồn không có cờ thì coi như còn hàng, không dán nhãn nhầm.
  const soldOut = product.inStock === false;

  return (
    <Link
      href={`/san-pham/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-card border border-stone-200 bg-stone-0 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-forest-600/40 hover:shadow-raised"
    >
      {/* Thumbnail Container */}
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-stone-100">
        {product.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnail}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            // Kích thước nội tại cho trình duyệt giữ chỗ trước khi ảnh về; CSS (h-full w-full trong khung vuông) vẫn quyết định hiển thị.
            width={400}
            height={400}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : undefined}
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-forest-50 text-forest-600">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="currentColor" fillOpacity="0.3" />
              <path d="M24 37c-1-8 4-15 14-16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
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

        {/* Brand Chip on Image Bottom */}
        <div className="absolute bottom-2 left-2.5 rounded-md bg-stone-0/90 px-2 py-0.5 text-xs font-semibold text-forest-800 shadow-card backdrop-blur-sm">
          {product.brand}
        </div>
      </div>

      {/* Info Content */}
      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-stone-900 transition-colors group-hover:text-forest-700">
          {product.name}
        </h3>

        <ProductPriceRow
          product={product}
          className="mt-2 flex items-baseline gap-2"
          priceClassName="text-base font-bold text-stone-900"
          originalClassName="text-xs text-stone-500 line-through"
        />

        {/* Footer Meta: Sold count & Rating */}
        {/* Sao chỉ hiện khi có đánh giá THẬT. Trước đây mọi sản phẩm đều khoe ★5.0 kể cả khi
            chưa ai đánh giá — vừa sai dữ liệu vừa là quảng cáo gây nhầm lẫn, và lưới gian hàng
            lại không có sao nào nên cùng một sản phẩm hiện hai thông tin khác nhau. */}
        <div className="mt-auto flex items-center justify-between pt-2 text-xs text-stone-600">
          {(product.reviewCount ?? 0) > 0 ? (
            <span className="flex items-center gap-1 font-medium text-stone-700">
              <svg className="h-3 w-3 fill-honey-500" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              {(product.ratingAvg ?? 0).toFixed(1)}
              <span className="text-stone-500">({product.reviewCount})</span>
            </span>
          ) : (
            <span />
          )}
          {formatSold(product.sold) && <span>{formatSold(product.sold)}</span>}
        </div>
      </div>
    </Link>
  );
}

