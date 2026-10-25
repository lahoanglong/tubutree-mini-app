import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { mergeSuggestions, SUGGEST_PAGE_SIZE, SUGGEST_TABS, type SuggestTab } from '@tubutree/app-core/home-layout';
import { fetchForYou, fetchProducts } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { CatalogGrid, CatalogGridSkeleton } from '../catalog/catalog-grid';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { ScrollRow } from '../ui/scroll-row';
import { Heading, Text } from '../ui/text';
import { HomeBlockError } from './home-block-error';

const LIST_SOURCE: Record<SuggestTab, string> = { 'for-you': 'home_for_you', 'best-seller': 'home_best_seller', newest: 'home_newest' };

/**
 * MỘT lưới gợi ý cuộn vô tận ở cuối Trang chủ, thay bốn lưới riêng. Ba nguồn đổi bằng chip: "Cho bạn" (gợi ý cá nhân hoá lên
 * đầu rồi tới danh mục), "Bán chạy", "Mới". Tải thêm khi kéo gần hết lưới; có nút "Xem thêm" cho máy không đo được cuộn.
 */
export function SuggestFeed() {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const [tab, setTab] = useState<SuggestTab>('for-you');
  const sort = SUGGEST_TABS.find((t) => t.key === tab)?.sort;
  const forYou = useQuery({ queryKey: ['for-you'], queryFn: fetchForYou, enabled: authed && tab === 'for-you' });
  const pages = useInfiniteQuery({
    queryKey: ['products', 'home-suggest', sort ?? 'default'],
    queryFn: ({ pageParam }) => fetchProducts({ limit: SUGGEST_PAGE_SIZE, ...(pageParam > 1 ? { page: pageParam } : {}), ...(sort ? { sort } : {}) }),
    initialPageParam: 1,
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

  return (
    <section aria-label={homeCopy.suggest.title} style={{ padding: '16px 16px 0' }}>
      <Heading variant="title-sm" as="h2">
        {homeCopy.suggest.title}
      </Heading>
      <ScrollRow label={homeCopy.suggest.tabsLabel} style={{ gap: 8, padding: '8px 0' }}>
        {SUGGEST_TABS.map((t) => (
          <Chip
            key={t.key}
            selected={tab === t.key}
            onPress={() => {
              haptic('light');
              setTab(t.key);
            }}
          >
            {t.label}
          </Chip>
        ))}
      </ScrollRow>
      {loadingFirst ? (
        <CatalogGridSkeleton count={6} />
      ) : items.length === 0 ? (
        pages.isError ? <HomeBlockError title={homeCopy.suggest.title} error={pages.error} onRetry={pages.refetch} retrying={pages.isFetching} /> : null
      ) : (
        <>
          <CatalogGrid products={items} listSource={LIST_SOURCE[tab]} />
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
