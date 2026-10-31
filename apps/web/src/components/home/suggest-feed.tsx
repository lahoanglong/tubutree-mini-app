'use client';

import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { mergeSuggestions, SUGGEST_PAGE_SIZE, SUGGEST_TABS, type SuggestTab } from '@tubutree/app-core/home-layout';
import { fetchProducts, type PageResponse, type ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { forYouQuery } from '@tubutree/app-core/queries/catalog';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { Button, Chip, Heading, PRIORITY_CARDS, ProductGrid, ScrollRow, Text } from '@/components/mini';
import { HomeBlockError } from './home-block-error';

/**
 * MỘT lưới gợi ý cuộn vô tận ở cuối Trang chủ (bản web của `suggest-feed.tsx` ở Mini App), thay bốn lưới riêng. Ba nguồn đổi bằng
 * chip: "Cho bạn" (gợi ý cá nhân hoá lên đầu rồi tới danh mục), "Bán chạy", "Mới". Tải thêm khi kéo gần hết lưới; có nút "Xem thêm"
 * cho máy không đo được cuộn.
 */
export function SuggestFeed({ initial }: { initial?: PageResponse<ProductCardData> }) {
  const authed = useAuthPhase() === 'authenticated';
  const [tab, setTab] = useState<SuggestTab>('for-you');
  const sort = SUGGEST_TABS.find((t) => t.key === tab)?.sort;
  const forYou = useQuery({ ...forYouQuery(coreHttp), enabled: authed && tab === 'for-you' });
  const pages = useInfiniteQuery({
    queryKey: ['products', 'home-suggest', sort ?? 'default'],
    queryFn: ({ pageParam }) => fetchProducts(coreHttp, { limit: SUGGEST_PAGE_SIZE, page: pageParam, ...(sort ? { sort } : {}) }),
    initialPageParam: 1,
    // Trang 1 của nguồn mặc định do server dựng sẵn trong HTML (SEO); đổi sang chip khác thì tải bình thường.
    ...(initial && !sort ? { initialData: { pages: [initial], pageParams: [1] }, staleTime: 60_000 } : {}),
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
  });
  const personal = tab === 'for-you' && authed ? (forYou.data ?? []) : [];
  const items = mergeSuggestions(personal, (pages.data?.pages ?? []).map((p) => p.data));
  const loadingFirst = pages.isLoading || (tab === 'for-you' && authed && forYou.isPending && !pages.data);

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  // Nguồn mặc định đã tải xong mà rỗng (không lỗi): không để lại tiêu đề và chip trên khoảng trống. Ở chip khác khối ở lại để khách còn đường quay về.
  if (tab === 'for-you' && !loadingFirst && !pages.isError && items.length === 0) return null;

  return (
    <section aria-label={homeCopy.suggest.title} style={{ padding: '16px 0 0' }}>
      <Heading variant="title-sm" as="h2">
        {homeCopy.suggest.title}
      </Heading>
      <ScrollRow label={homeCopy.suggest.tabsLabel} style={{ gap: 8, padding: '8px 0' }}>
        {SUGGEST_TABS.map((t) => (
          <Chip key={t.key} selected={tab === t.key} onPress={() => setTab(t.key)}>
            {t.label}
          </Chip>
        ))}
      </ScrollRow>
      {loadingFirst ? (
        <ProductGrid items={[]} variant="grid" loading skeletonCount={6} />
      ) : items.length === 0 ? (
        pages.isError ? <HomeBlockError title={homeCopy.suggest.title} error={pages.error} onRetry={pages.refetch} retrying={pages.isFetching} /> : null
      ) : (
        <>
          <ProductGrid items={items} variant="grid" priorityCount={tab === 'for-you' ? PRIORITY_CARDS : 0} />
          <div ref={sentinel} aria-hidden style={{ height: 1 }} />
          {hasNextPage ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
              <Button variant="secondary" loading={isFetchingNextPage} onPress={() => void fetchNextPage()} style={{ minWidth: 160 }}>
                {homeCopy.suggest.more}
              </Button>
            </div>
          ) : (
            <Text variant="caption" tone="tertiary" as="p" style={{ textAlign: 'center', padding: '16px 0' }}>
              {homeCopy.suggest.end}
            </Text>
          )}
        </>
      )}
    </section>
  );
}
