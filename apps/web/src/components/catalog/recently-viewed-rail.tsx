'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { recentlyViewedQuery } from '@tubutree/app-core/queries/catalog';
import { browseText } from '@/lib/browse-text';
import { coreHttp } from '@/lib/core-http';
import { useRecentlyViewed } from '@/lib/use-recently-viewed';
import { pruneRecentlyViewed } from '@/lib/recently-viewed';
import { ProductCard } from '@/components/mini/product-card';
import { RailCell, RailShell } from '@/components/mini/product-rail';
import { Section } from '@/components/mini/section';
import { SectionHeader } from '@/components/mini/section-header';

/** Chiều cao dải khi dựng đầy đủ ở khổ điện thoại và máy tính (đo ở e2e `san-pham-hub-cls.web`); chỉ để giữ chỗ khi server chưa biết khách đã xem gì. */
const RESERVED_HEIGHT = 'h-[250px]';

const subscribeNever = () => () => undefined;

/**
 * "Đã xem gần đây": thẻ `rail-sm` của bộ thẻ chung. Dữ liệu lưu ở máy chỉ có slug, tên, ảnh (không có đánh giá hay id), nên thẻ dựng từ
 * chúng với `id = slug`: không đủ dữ kiện cho nhãn "Mới" hay "Tubu chọn" (thẻ `rail-sm` không có nhãn đầu tên) và không có tim. Tên và ảnh
 * đọc từ localStorage nên thẻ hiện ngay. GIÁ không lưu (giá đổi theo Giờ vàng/khuyến mãi): hỏi giá hiện hành theo slug và để `ProductCard`
 * tính Giờ vàng như thẻ ở lưới, nên hai nơi trên một trang không lệch giá. Chưa có giá (đang tải, lỗi mạng, API cũ) thì thẻ không in giá
 * (`hidePrice`); sản phẩm đã ẩn hoặc chưa duyệt thì thẻ biến mất. Kho lưu giữ 20 món nhưng dải chỉ hiện `shelf('browse.recent').maxItems`
 * món mới xem nhất, tính sau khi bỏ món đã gỡ.
 *
 * `reserve`: trang Danh mục dựng sẵn (ISR) không biết khách đã xem gì, nên HTML đầu không có dải; script ở <head> (`recentlyViewedBootScript`) đặt
 * `data-has-recent` lên <html> khi máy có mục đã xem, và chỉ khi đó CSS mới giữ chỗ `RESERVED_HEIGHT` cho tới khi dải thật dựng ở lần hydrate.
 * Khách chưa xem gì không có thuộc tính nên không mất chỗ nào.
 *
 * `priorityCount`: số thẻ đầu tải ảnh ngay. Dải chỉ dựng ở trình duyệt (không có trong HTML server) nên không tranh chỗ với ảnh ưu tiên của kệ phía dưới trong HTML đầu.
 */
export function RecentlyViewedRail({ title = browseText.recentlyViewed, reserve = false, priorityCount = 0 }: { title?: string; reserve?: boolean; priorityCount?: number }) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const stored = useRecentlyViewed();
  const slugs = stored.map((it) => it.slug);
  const live = useQuery({ ...recentlyViewedQuery(coreHttp, slugs), enabled: slugs.length > 0, staleTime: 30_000 });
  const bySlug = new Map((live.data ?? []).map((p) => [p.slug, p]));
  // API đã trả lời: mục không còn (ẩn/gỡ) bị xoá khỏi máy, để lần sau script ở <head> không giữ chỗ cho dải sẽ biến mất. Trong lần vào này dải đã dựng từ kho trước khi API trả lời
  // (giữ chỗ rồi chờ API sẽ trì hoãn ảnh ưu tiên của đường thường), nên khi cả danh sách bị ẩn thì dải vẫn thu lại một lần: chỉ xảy ra khi mọi món đã xem đều bị gỡ.
  useEffect(() => {
    if (live.isSuccess) pruneRecentlyViewed(new Set((live.data ?? []).map((p) => p.slug)));
  }, [live.isSuccess, live.data]);
  const items = (live.isSuccess ? stored.filter((it) => bySlug.has(it.slug)) : stored).slice(0, shelf('browse.recent').maxItems);
  if (items.length === 0) {
    return reserve && !hydrated ? <div data-testid="recent-slot" aria-hidden="true" className={`hidden [html[data-has-recent]_&]:block ${RESERVED_HEIGHT}`} /> : null;
  }
  return (
    <Section id="browse-recent" label={title}>
      <SectionHeader title={title} />
      <RailShell label={title}>
        {items.map((it, index) => {
          const product = bySlug.get(it.slug);
          return (
            <RailCell key={it.slug} variant="rail-sm">
              <ProductCard
                // Tên là của lần xem; ảnh, giá và còn hàng lấy từ dữ liệu hiện hành (URL ảnh lưu ở máy chỉ là dự phòng khi chưa có dữ liệu hiện hành).
                product={{
                  id: it.slug,
                  brand: '',
                  basePrice: 0,
                  salePrice: null,
                  isFeatured: false,
                  inStock: true,
                  ...product,
                  slug: it.slug,
                  name: it.name,
                  // Ảnh hiện hành thắng: URL lưu ở máy có thể là ảnh cũ đã bị thay, /img không còn nhận (404) nên thẻ phải lùi về ảnh gốc.
                  thumbnail: product?.thumbnail ?? it.thumbnail ?? null,
                }}
                priority={index < priorityCount}
                variant="rail-sm"
                hidePrice={!product}
              />
            </RailCell>
          );
        })}
      </RailShell>
    </Section>
  );
}
