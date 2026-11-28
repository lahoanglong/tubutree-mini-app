'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_INTERLEAVE_AFTER, mergeSuggestions, SUGGEST_FIRST_RENDER, SUGGEST_FIRST_RENDER_WIDE, SUGGEST_PAGE_SIZE } from '@tubutree/app-core/home-layout';
import { suggestLimit, vnDateSeed } from '@tubutree/app-core/home-suggest';
import { fetchCatalog, fetchForYou, type PageResponse, type ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { serverNow } from '@tubutree/app-core/server-clock';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { Button, ProductCard, ProductGrid, SectionHeader, Text } from '@/components/mini';
import { GRID_PRODUCTS, gridImageSizes } from '@/lib/product-grid';
import { MD_UP, useMediaQuery } from '@/lib/use-media-query';
import { HomeBlockError } from './home-block-error';

/** Nút cuối lưới rộng 10rem (nửa khối ở khổ rất hẹp): chữ ngắn ("Xem thêm") không ra nút bé tí giữa khoảng trắng. */
const MORE_BUTTON = { minWidth: 'min(50%, 10rem)' } as const;

// Từ lg lưới 5–6 cột và có thanh đầu trang đủ lối vào Danh mục: dừng ở 48 món (đủ 8 hàng 6 cột) rồi mời "Xem thêm" ở trang sản phẩm.
const DESKTOP_QUERY = '(min-width: 1024px)';
const subscribeDesktop = (cb: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isDesktop = () => typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;

export interface SuggestFeedProps {
  /** Trang 1 do server dựng sẵn trong HTML (SEO); xếp theo `seed`. */
  initial?: PageResponse<ProductCardData>;
  /** Hạt giống mà `initial` đã dùng: giữ nguyên cả lần mở để HTML đầu và lưới sau hydrate là một thứ tự. Không có thì lấy ngày Việt Nam hiện tại. */
  seed?: string;
  /** Slug món đã nằm ở các kệ hàng phía trên: lưới không lặp lại chúng. */
  exclude: ReadonlySet<string>;
  /** Thẻ chen (dải "Khách hàng sống xanh", không đủ thì thẻ của ngày) trải hết bề ngang lưới, đứng sau `HOME_INTERLEAVE_AFTER` thẻ đầu. Lưới ít thẻ hơn thì không chen. */
  interleave?: ReactNode;
}

/**
 * Lưới thẻ của `ProductGrid` có thể chen một thẻ trải hết bề ngang: vị trí `position` của các thẻ sau thẻ chen vẫn đếm tiếp từ thẻ đầu (không đếm lại từ 1),
 * nên số đo `product_card_click` của lưới không lệch.
 */
function SuggestGrid({ items, interleave }: { items: readonly ProductCardData[]; interleave?: ReactNode }) {
  const sizes = gridImageSizes(GRID_PRODUCTS);
  const chenAt = interleave && items.length >= HOME_INTERLEAVE_AFTER ? HOME_INTERLEAVE_AFTER - 1 : -1;
  // Từ md lưới 3–6 cột nên 8 thẻ trước thẻ chen để lại ô trống ở hàng cuối; xếp dày để thẻ sau thẻ chen lấp vào.
  return (
    <ul role="list" data-testid="catalog-grid" className={`${GRID_PRODUCTS} md:grid-flow-row-dense`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.flatMap((p, i) => {
        const card = (
          <li key={`${p.id}:${i}`} style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <ProductCard product={p} variant="grid" imageSizes={sizes} shelf="suggest" position={i + 1} />
            </div>
          </li>
        );
        // Thẻ chen không vẽ gì (Cộng đồng chưa có bài) thì ô bị ẩn hẳn, không để lại một hàng trống giữa lưới.
        return i === chenAt ? [card, <li key="interleave" data-testid="suggest-interleave" className="empty:hidden" style={{ gridColumn: '1 / -1', minWidth: 0 }}>{interleave}</li>] : [card];
      })}
    </ul>
  );
}

/**
 * "Gợi ý cho bạn" (W47, bản web của `suggest-feed.tsx` ở Mini App): MỘT lưới cuộn dần ở cuối Trang chủ; duyệt theo thương hiệu nằm ở thanh chip dưới Danh mục. Thứ tự xoay
 * theo ngày Việt Nam (`seed`): cuộn, quay lại, mở lại trong ngày không xáo lưới, sang ngày khác thì đổi. Khách đã đăng nhập thấy gợi ý cá nhân lên đầu.
 * Dừng ở `SUGGEST_MAX` món (máy tính `SUGGEST_MAX_DESKTOP`) rồi mời vào trang sản phẩm: cuộn vô tận không có đáy làm khách mất đường tới chân trang.
 */
export function SuggestFeed({ initial, seed: serverSeed, exclude, interleave }: SuggestFeedProps) {
  const router = useRouter();
  const authed = useAuthPhase() === 'authenticated';
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  // Từ md lưới từ 3 cột: lần mở đầu vẽ `SUGGEST_FIRST_RENDER_WIDE` thẻ. HTML server là bản điện thoại; thẻ thêm sau hydrate nằm dưới thẻ chen, dưới màn đầu.
  const wide = useMediaQuery(MD_UP);
  // Chốt một lần mỗi lần mở: qua nửa đêm giữa chừng không đổi thứ tự dưới chân khách.
  const [seed] = useState(() => serverSeed ?? vnDateSeed(serverNow()));
  const forYou = useQuery({ queryKey: ['for-you', seed], queryFn: () => fetchForYou(coreHttp, { seed }), enabled: authed });
  const pages = useInfiniteQuery({
    queryKey: ['products', 'home-suggest', seed, 'all'],
    queryFn: ({ pageParam }) => fetchCatalog(coreHttp, { page: pageParam, limit: SUGGEST_PAGE_SIZE, seed }),
    initialPageParam: 1,
    // Trang 1 do server dựng sẵn trong HTML.
    ...(initial && serverSeed ? { initialData: { pages: [{ ...initial, filtersIgnored: false }], pageParams: [1] }, staleTime: 60_000 } : {}),
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
  });
  const personal = authed ? (forYou.data ?? []) : [];
  const fresh = mergeSuggestions(personal, (pages.data?.pages ?? []).map((p) => p.data)).filter((p) => !exclude.has(p.slug));
  const { max } = suggestLimit(fresh.length, desktop);
  const capped = fresh.length >= max;
  const items = capped ? fresh.slice(0, max) : fresh;
  const loadingFirst = pages.isLoading || (authed && forYou.isPending && !pages.data);
  // Dựng dần (`SUGGEST_FIRST_RENDER`).
  const first = wide ? SUGGEST_FIRST_RENDER_WIDE : SUGGEST_FIRST_RENDER;
  const [reveal, setReveal] = useState(0);
  const shownCount = Math.max(reveal, first);
  const shown = items.slice(0, shownCount);
  const hidden = items.length > shownCount;

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const canLoadMore = hasNextPage && !capped;
  // Còn thẻ đã tải mà chưa vẽ thì vẽ thêm (không gọi mạng); hết rồi mới tải trang sau, và trang đó hiện ngay khi về.
  const more = useCallback(() => {
    if (hidden) {
      setReveal(shownCount + SUGGEST_PAGE_SIZE);
    } else if (!isFetchingNextPage) {
      setReveal(items.length + SUGGEST_PAGE_SIZE);
      void fetchNextPage();
    }
  }, [hidden, shownCount, items.length, isFetchingNextPage, fetchNextPage]);
  // Trang sau tải lỗi thì không tự tải lại khi sentinel còn trong khung (lặp request mỗi lần dựng lại); nút "Xem thêm" là lối thử lại.
  const autoMore = hidden || (canLoadMore && !pages.isFetchNextPageError);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !autoMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) more();
      },
      { rootMargin: '50% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoMore, more, items.length]);

  // Cả trang đã tải đều là món nằm ở kệ trên: lưới rỗng nhưng còn trang sau, nên tải tiếp (không có gì trên màn để cuộn tới thì không có sentinel chạm) thay vì ẩn khối.
  const draining = items.length === 0 && !!hasNextPage && !pages.isError;
  useEffect(() => {
    if (draining && !isFetchingNextPage) void fetchNextPage();
  }, [draining, isFetchingNextPage, fetchNextPage]);

  // Tải xong mà rỗng (không lỗi, hết trang): không để lại tiêu đề trên khoảng trống.
  if (!loadingFirst && !draining && !pages.isError && items.length === 0) return null;

  const toBrowse = () => router.push(browseHref(EMPTY_SEARCH_STATE));
  return (
    <section aria-label={homeCopy.suggest.title} data-testid="home-suggest">
      <SectionHeader title={homeCopy.suggest.title} />
      {loadingFirst || draining ? (
        <ProductGrid items={[]} variant="grid" loading skeletonCount={6} />
      ) : items.length === 0 ? (
        <HomeBlockError title={homeCopy.suggest.title} error={pages.error} onRetry={pages.refetch} retrying={pages.isFetching} />
      ) : (
        <>
          {/* Khối cuối trang chủ, nằm dưới màn đầu: tải lười, không đặt ảnh ưu tiên. */}
          <SuggestGrid items={shown} interleave={interleave} />
          <div ref={sentinel} aria-hidden style={{ height: 1 }} />
          {hidden || canLoadMore ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-stack-md) 0' }}>
              <Button variant="secondary" loading={!hidden && isFetchingNextPage} onPress={more} style={MORE_BUTTON}>
                {homeCopy.suggest.more}
              </Button>
            </div>
          ) : capped && desktop ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-stack-md) 0' }}>
              <Button variant="secondary" onPress={toBrowse} style={MORE_BUTTON}>
                {homeCopy.suggest.more}
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-stack-sm)', padding: 'var(--space-stack-md) 0' }}>
              <Text variant="caption" tone="tertiary" as="p" style={{ margin: 0, textAlign: 'center' }}>
                {homeCopy.suggest.end}
              </Text>
              <Button variant="secondary" onPress={toBrowse} style={MORE_BUTTON}>
                {homeCopy.suggest.enter}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
