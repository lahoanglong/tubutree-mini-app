'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { recentlyViewedQuery } from '@tubutree/app-core/queries/catalog';
import { recentlyViewedQuerySlugs } from '@tubutree/app-core/recently-viewed-query';
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
  // Chỉ hỏi những slug vừa trần độ dài của API (mới nhất trước); phần cũ hơn không được hỏi nên không bị dọn (và không hiện ở dải).
  const queried = recentlyViewedQuerySlugs(slugs);
  const queriedSet = new Set(queried);
  const live = useQuery({ ...recentlyViewedQuery(coreHttp, queried), enabled: queried.length > 0, staleTime: 30_000 });
  const bySlug = new Map((live.data ?? []).map((p) => [p.slug, p]));
  // API đã trả lời: mục không còn (ẩn/gỡ) bị xoá khỏi máy, để lần sau script ở <head> không giữ chỗ cho dải sẽ biến mất. Trong lần vào này dải đã dựng từ kho trước khi API trả lời
  // (giữ chỗ rồi chờ API sẽ trì hoãn ảnh ưu tiên của đường thường), nên khi cả danh sách bị ẩn thì dải vẫn thu lại một lần: chỉ xảy ra khi mọi món đã xem đều bị gỡ.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!live.isSuccess) return;
    const keep = new Set((live.data ?? []).map((p) => p.slug));
    const nextQueried = recentlyViewedQuerySlugs(slugs.filter((s) => !queriedSet.has(s) || keep.has(s)));
    // Sau khi xoá, khoá truy vấn đổi theo danh sách slug mới: nạp sẵn dữ liệu cho khoá mới để thẻ không chớp (không mất giá, không lùi về URL ảnh cũ) và không tốn lần gọi thừa.
    // Chỉ nạp khi khoá mới không kéo thêm slug chưa từng được hỏi (món cũ nhích vào trần): khi đó để truy vấn tự chạy.
    if (nextQueried.length > 0 && nextQueried.length !== queried.length && nextQueried.every((s) => keep.has(s))) {
      queryClient.setQueryData(recentlyViewedQuery(coreHttp, nextQueried).queryKey, (live.data ?? []).filter((p) => keep.has(p.slug)));
    }
    pruneRecentlyViewed(keep, queriedSet);
    // `slugs` không cần trong deps: `live.data` thuộc khoá dựng từ chính `slugs` (không có placeholderData). Nếu thêm placeholderData thì phải chặn `live.isPlaceholderData`, kẻo dọn bằng dữ liệu của danh sách cũ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.isSuccess, live.data]);
  // Sau khi API trả lời chỉ hiện món đã hỏi VÀ được trả về: món ngoài trần (slug dài) không có giá để in và không biết còn bán hay đã ẩn (thẻ có thể dẫn tới 404), nên không vẽ; nó vẫn nằm trong kho, không bị dọn.
  // Không gây nhảy dọc: chiều cao dải do thẻ quyết định (mọi thẻ cùng khổ), bớt thẻ chỉ ngắn dải theo chiều ngang; dải chỉ thu lại khi không còn thẻ nào, như trường hợp mọi món bị ẩn.
  // Trước khi API trả lời cũng chỉ vẽ món nằm trong `queried` (phần đầu của kho), nên thẻ ngoài trần không hiện thoáng qua rồi biến mất.
  const items = stored.filter((it) => queriedSet.has(it.slug) && (!live.isSuccess || bySlug.has(it.slug))).slice(0, shelf('browse.recent').maxItems);
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
