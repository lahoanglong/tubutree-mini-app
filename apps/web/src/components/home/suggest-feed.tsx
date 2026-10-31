'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { mergeSuggestions, SUGGEST_PAGE_SIZE } from '@tubutree/app-core/home-layout';
import { suggestChips, suggestLimit, vnDateSeed } from '@tubutree/app-core/home-suggest';
import { fetchCatalog, fetchForYou, type CategoryDTO, type PageResponse, type ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { serverNow } from '@tubutree/app-core/server-clock';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { Button, Chip, PRIORITY_CARDS, ProductGrid, ScrollRow, SectionHeader, Text } from '@/components/mini';
import { HomeBlockError } from './home-block-error';

// Từ lg lưới 5–6 cột và có thanh đầu trang đủ lối vào Danh mục: dừng ở 48 món (đủ 8 hàng 6 cột) rồi mời "Xem thêm" ở trang sản phẩm.
const DESKTOP_QUERY = '(min-width: 1024px)';
const subscribeDesktop = (cb: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isDesktop = () => typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;

// Điện thoại: hàng chip dính ngay dưới header dính của Trang chủ (h-14 = 56px), dưới z-index của header (z-20), tràn mép màn như Mini. Từ md thanh đầu
// website lo phần đầu trang nên hàng chip nằm trong khung và không dính.
const CHIPS_CLASS = 'max-md:sticky max-md:top-14 max-md:z-10 max-md:-mx-4 max-md:max-w-none max-md:bg-[var(--color-bg-canvas)] max-md:px-4';

export interface SuggestFeedProps {
  /** Trang 1 của chip "Tất cả" do server dựng sẵn trong HTML (SEO); xếp theo `seed`. */
  initial?: PageResponse<ProductCardData>;
  /** Hạt giống mà `initial` đã dùng: giữ nguyên cả lần mở để HTML đầu và lưới sau hydrate là một thứ tự. Không có thì lấy ngày Việt Nam hiện tại. */
  seed?: string;
  /** Danh mục của cửa hàng (chip lấy tầng 1 nhiều sản phẩm nhất). */
  categories: CategoryDTO[];
  /** Slug món đã nằm ở các kệ hàng phía trên: lưới không lặp lại chúng. */
  exclude: ReadonlySet<string>;
}

/**
 * "Gợi ý hôm nay" (Q9, bản web của `suggest-feed.tsx` ở Mini App): MỘT lưới cuộn vô tận ở cuối Trang chủ, đổi chủ đề bằng chip danh mục thay cho ba tab nguồn.
 * Thứ tự xoay theo ngày Việt Nam (`seed`): cuộn, quay lại, mở lại trong ngày không xáo lưới, sang ngày khác thì đổi. Khách đã đăng nhập thấy gợi ý cá nhân lên
 * đầu ở chip "Tất cả". Dừng ở `SUGGEST_MAX` món (máy tính `SUGGEST_MAX_DESKTOP`) rồi mời vào trang sản phẩm: cuộn vô tận không có đáy làm khách mất đường tới chân trang.
 */
export function SuggestFeed({ initial, seed: serverSeed, categories, exclude }: SuggestFeedProps) {
  const router = useRouter();
  const authed = useAuthPhase() === 'authenticated';
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  // Chốt một lần mỗi lần mở: qua nửa đêm giữa chừng không đổi thứ tự dưới chân khách.
  const [seed] = useState(() => serverSeed ?? vnDateSeed(serverNow()));
  const chips = useMemo(() => suggestChips(categories.filter((c) => !c.parentId)), [categories]);
  const [chipKey, setChipKey] = useState('all');
  const active = chips.find((c) => c.key === chipKey) ?? chips[0]!;
  const categoryId = active.categoryId;

  const forYou = useQuery({ queryKey: ['for-you', seed], queryFn: () => fetchForYou(coreHttp, { seed }), enabled: authed && categoryId === null });
  const pages = useInfiniteQuery({
    queryKey: ['products', 'home-suggest', seed, categoryId ?? 'all'],
    queryFn: ({ pageParam }) => fetchCatalog(coreHttp, { page: pageParam, limit: SUGGEST_PAGE_SIZE, seed, ...(categoryId ? { category: categoryId } : {}) }),
    initialPageParam: 1,
    // Trang 1 của "Tất cả" do server dựng sẵn trong HTML; đổi sang chip khác thì tải bình thường.
    ...(initial && serverSeed && categoryId === null ? { initialData: { pages: [{ ...initial, filtersIgnored: false }], pageParams: [1] }, staleTime: 60_000 } : {}),
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
  });
  const personal = categoryId === null && authed ? (forYou.data ?? []) : [];
  const fresh = mergeSuggestions(personal, (pages.data?.pages ?? []).map((p) => p.data)).filter((p) => !exclude.has(p.slug));
  const { max } = suggestLimit(fresh.length, desktop);
  const capped = fresh.length >= max;
  const items = capped ? fresh.slice(0, max) : fresh;
  const loadingFirst = pages.isLoading || (categoryId === null && authed && forYou.isPending && !pages.data);

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const canLoadMore = hasNextPage && !capped;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [canLoadMore, isFetchingNextPage, fetchNextPage, items.length]);

  // "Tất cả" đã tải xong mà rỗng (không lỗi): không để lại tiêu đề và chip trên khoảng trống. Ở chip khác khối ở lại để khách còn đường quay về.
  if (categoryId === null && !loadingFirst && !pages.isError && items.length === 0) return null;

  const toBrowse = () => router.push(browseHref(EMPTY_SEARCH_STATE));
  return (
    <section aria-label={homeCopy.suggest.title}>
      <SectionHeader title={homeCopy.suggest.title} />
      <ScrollRow label={homeCopy.suggest.chipsLabel} className={CHIPS_CLASS} style={{ gap: 8, paddingBlock: 8 }}>
        {chips.map((c) => (
          <Chip key={c.key} selected={active.key === c.key} onPress={() => setChipKey(c.key)}>
            {c.label}
          </Chip>
        ))}
      </ScrollRow>
      {loadingFirst ? (
        <ProductGrid items={[]} variant="grid" loading skeletonCount={6} />
      ) : items.length === 0 ? (
        pages.isError ? <HomeBlockError title={homeCopy.suggest.title} error={pages.error} onRetry={pages.refetch} retrying={pages.isFetching} /> : null
      ) : (
        <>
          <ProductGrid items={items} variant="grid" priorityCount={categoryId === null ? PRIORITY_CARDS : 0} />
          <div ref={sentinel} aria-hidden style={{ height: 1 }} />
          {canLoadMore ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
              <Button variant="secondary" loading={isFetchingNextPage} onPress={() => void fetchNextPage()} style={{ minWidth: 160 }}>
                {homeCopy.suggest.more}
              </Button>
            </div>
          ) : capped && desktop ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
              <Button variant="secondary" onPress={toBrowse} style={{ minWidth: 160 }}>
                {homeCopy.suggest.more}
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '16px 0' }}>
              <Text variant="caption" tone="tertiary" as="p" style={{ margin: 0, textAlign: 'center' }}>
                {homeCopy.suggest.end}
              </Text>
              <Button variant="secondary" onPress={toBrowse} style={{ minWidth: 160 }}>
                {homeCopy.suggest.enter}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
