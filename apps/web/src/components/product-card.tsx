import Link from 'next/link';
import { type ProductCard as P, formatVnd, formatSold } from '@/lib/api';

export default function ProductCard({ product }: { product: P }) {
  const price = product.salePrice ?? product.basePrice;
  const hasSale = product.salePrice != null && product.salePrice < product.basePrice;
  return (
    <Link
      href={`/san-pham/${product.slug}`}
      className="block overflow-hidden rounded-lg bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="flex aspect-square items-center justify-center bg-leaf-50 text-4xl">
        {product.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.thumbnail} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          '🌿'
        )}
      </div>
      <div className="p-3">
        <div className="text-xs font-semibold text-primary-600">{product.brand}</div>
        <div className="line-clamp-2 min-h-[2.5rem] text-sm text-neutral-900">{product.name}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-bold text-clay-700">{formatVnd(price)}</span>
          {hasSale && (
            <span className="text-xs text-neutral-400 line-through">{formatVnd(product.basePrice)}</span>
          )}
        </div>
        {formatSold(product.sold) && (
          <div className="mt-0.5 text-xs text-neutral-400">{formatSold(product.sold)}</div>
        )}
      </div>
    </Link>
  );
}
