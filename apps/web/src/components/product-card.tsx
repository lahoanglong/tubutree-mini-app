import Link from 'next/link';
import { type ProductCard as P, formatVnd, formatSold } from '@/lib/api';

export default function ProductCard({ product }: { product: P }) {
  const price = product.salePrice ?? product.basePrice;
  const hasSale = product.salePrice != null && product.salePrice < product.basePrice;
  const discountPct = hasSale
    ? Math.round(((product.basePrice - price) / product.basePrice) * 100)
    : 0;

  return (
    <Link
      href={`/san-pham/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-leaf-600/40 hover:shadow-lg"
    >
      {/* Thumbnail Container */}
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-neutral-100/60">
        {product.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnail}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-leaf-50/70 text-leaf-600">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="#95D222" />
              <path d="M24 37c-1-8 4-15 14-16" stroke="#509018" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        )}

        {/* Sale Badge */}
        {hasSale && discountPct > 0 && (
          <div className="absolute left-2.5 top-2.5 rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
            -{discountPct}%
          </div>
        )}

        {/* Brand Chip on Image Bottom */}
        <div className="absolute bottom-2 left-2.5 rounded-md bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-leaf-900 shadow-sm backdrop-blur-sm">
          {product.brand}
        </div>
      </div>

      {/* Info Content */}
      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-neutral-900 transition-colors group-hover:text-primary-700">
          {product.name}
        </h3>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-base font-bold text-clay-700">{formatVnd(price)}</span>
          {hasSale && (
            <span className="text-xs text-neutral-400 line-through">
              {formatVnd(product.basePrice)}
            </span>
          )}
        </div>

        {/* Footer Meta: Sold count & Rating */}
        {/* Sao chỉ hiện khi có đánh giá THẬT. Trước đây mọi sản phẩm đều khoe ★5.0 kể cả khi
            chưa ai đánh giá — vừa sai dữ liệu vừa là quảng cáo gây nhầm lẫn, và lưới gian hàng
            lại không có sao nào nên cùng một sản phẩm hiện hai thông tin khác nhau. */}
        <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-neutral-500">
          {(product.reviewCount ?? 0) > 0 ? (
            <span className="flex items-center gap-1 font-medium text-leaf-700">
              <svg className="h-3 w-3 fill-leaf-600" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              {(product.ratingAvg ?? 0).toFixed(1)}
              <span className="text-neutral-400">({product.reviewCount})</span>
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

