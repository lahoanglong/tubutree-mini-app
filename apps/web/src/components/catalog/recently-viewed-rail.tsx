'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { recentlyViewedQuery } from '@tubutree/app-core/queries/catalog';
import { browseText } from '@/lib/browse-text';
import { coreHttp } from '@/lib/core-http';
import { useRecentlyViewed } from '@/lib/use-recently-viewed';
import { ProductPriceRow } from '@/components/flash-price';
import { ScrollRail } from '@/components/scroll-rail';
import { ThumbPlaceholder } from '@/components/thumb-placeholder';

/**
 * "Đã xem gần đây": thẻ gọn, tên và ảnh đọc từ localStorage nên hiện ngay. GIÁ không lưu (giá đổi theo Giờ vàng/khuyến mãi):
 * hỏi giá hiện hành theo slug, cùng cách tính giá Giờ vàng như thẻ ở lưới nên hai nơi trên một trang không lệch giá. Chưa có
 * giá (đang tải, lỗi mạng, API cũ) thì thẻ không hiện giá; sản phẩm đã ẩn hoặc chưa duyệt thì thẻ biến mất.
 */
export function RecentlyViewedRail({ title = browseText.recentlyViewed }: { title?: string }) {
  const stored = useRecentlyViewed();
  const slugs = stored.map((it) => it.slug);
  const live = useQuery({ ...recentlyViewedQuery(coreHttp, slugs), enabled: slugs.length > 0, staleTime: 30_000 });
  const bySlug = new Map((live.data ?? []).map((p) => [p.slug, p]));
  const items = live.isSuccess ? stored.filter((it) => bySlug.has(it.slug)) : stored;
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="py-2">
      <h2 className="mb-2 font-display text-lg font-semibold text-stone-900">{title}</h2>
      <ScrollRail className="flex gap-2.5 overflow-x-auto px-1 pb-3 pt-1">
        {items.map((it) => {
          const product = bySlug.get(it.slug);
          return (
            <li key={it.slug} className="w-32 flex-none">
              <Link
                href={`/san-pham/${encodeURIComponent(it.slug)}`}
                aria-label={it.name}
                className="block overflow-hidden rounded-card bg-stone-0 shadow-card transition hover:shadow-raised"
              >
                <div className="aspect-square w-full bg-stone-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {it.thumbnail ? <img src={it.thumbnail} alt="" width={128} height={128} loading="lazy" className="h-full w-full object-cover" /> : <ThumbPlaceholder iconSize={28} />}
                </div>
                <div className="p-2">
                  <p className="line-clamp-2 min-h-[2rem] text-xs text-stone-900">{it.name}</p>
                  <div className="min-h-[1.375rem]">
                    {product && (
                      <ProductPriceRow
                        product={product}
                        className="flex flex-wrap items-baseline gap-x-1.5"
                        priceClassName="text-sm font-bold text-stone-900"
                        originalClassName="text-xs text-stone-500 line-through"
                      />
                    )}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ScrollRail>
    </section>
  );
}
