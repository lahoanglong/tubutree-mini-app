import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_HEADER_HEIGHT, mergeSuggestions, SUGGEST_PAGE_SIZE } from '@tubutree/app-core/home-layout';
import { SUGGEST_MAX, suggestChips, vnDateSeed } from '@tubutree/app-core/home-suggest';
import { useCategories } from '../../hooks/use-categories';
import { fetchCatalog, fetchForYou } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { serverNow } from '../../utils/server-clock';
import { CatalogGrid, CatalogGridSkeleton } from '../catalog/catalog-grid';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { ScrollRow } from '../ui/scroll-row';
import { SectionHeader } from '../ui/section-header';
import { Text } from '../ui/text';
import { HomeBlockError } from './home-block-error';

// Hàng chip dính ngay dưới header dính của Trang chủ (cao `HOME_HEADER_HEIGHT`, đứng ở `--safe-top`), dưới z-index của header (20).
const CHIPS_STYLE = {
  gap: 8,
  padding: '8px 16px',
  position: 'sticky',
  top: `calc(var(--safe-top) + ${HOME_HEADER_HEIGHT}px)`,
  zIndex: 10,
  background: 'var(--color-bg-canvas)',
} as const;

export interface SuggestFeedProps {
  /** Slug món đã nằm ở các kệ hàng phía trên: lưới không lặp lại chúng. */
  exclude: ReadonlySet<string>;
}

/**
 * "Gợi ý hôm nay" (Q9): MỘT lưới cuộn vô tận ở cuối Trang chủ, đổi chủ đề bằng chip danh mục thay cho ba tab nguồn. Thứ tự xoay theo ngày Việt Nam
 * (`seed`): cuộn, quay lại, mở lại app trong ngày không xáo lưới, sang ngày khác thì đổi. Khách đã đăng nhập thấy gợi ý cá nhân lên đầu ở chip "Tất cả".
 * Dừng ở `SUGGEST_MAX` món rồi mời vào Danh mục: cuộn vô tận không có đáy làm khách mất đường tới chân trang và thanh đáy.
 */
export function SuggestFeed({ exclude }: SuggestFeedProps) {
  const navigate = useNavigate();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  // Chốt một lần mỗi lần mở: qua nửa đêm giữa chừng không đổi thứ tự dưới chân khách.
  const seed = useMemo(() => vnDateSeed(serverNow()), []);
  const { categories } = useCategories();
  const chips = useMemo(() => suggestChips(categories.filter((c) => !c.parentId)), [categories]);
  const [chipKey, setChipKey] = useState('all');
  const active = chips.find((c) => c.key === chipKey) ?? chips[0]!;
  const categoryId = active.categoryId;

  // Lưới nằm cuối Trang chủ: chỉ tải khi khối cách màn hình chưa tới một màn. Lần mở Trang chủ bớt một request so với khi tải ngay; web không có
  // request này vì trang 1 đã dựng sẵn ở server.
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = section.current;
    if (near || !el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const forYou = useQuery({ queryKey: ['for-you', seed], queryFn: () => fetchForYou({ seed }), enabled: near && authed && categoryId === null });
  const pages = useInfiniteQuery({
    queryKey: ['products', 'home-suggest', seed, categoryId ?? 'all'],
    queryFn: ({ pageParam }) => fetchCatalog({ page: pageParam, limit: SUGGEST_PAGE_SIZE, seed, ...(categoryId ? { category: categoryId } : {}) }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    enabled: near,
  });
  const personal = categoryId === null && authed ? (forYou.data ?? []) : [];
  const fresh = mergeSuggestions(personal, (pages.data?.pages ?? []).map((p) => p.data)).filter((p) => !exclude.has(p.slug));
  const capped = fresh.length >= SUGGEST_MAX;
  const items = capped ? fresh.slice(0, SUGGEST_MAX) : fresh;
  const loadingFirst = !near || pages.isLoading || (categoryId === null && authed && forYou.isPending && !pages.data);

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

  // Cả trang đã tải đều là món nằm ở kệ trên: lưới rỗng nhưng còn trang sau, nên tải tiếp (không có gì trên màn để cuộn tới thì không có sentinel chạm) thay vì ẩn khối.
  const draining = items.length === 0 && !!hasNextPage && !pages.isError;
  useEffect(() => {
    if (draining && !isFetchingNextPage) void fetchNextPage();
  }, [draining, isFetchingNextPage, fetchNextPage]);

  // "Tất cả" đã tải xong mà rỗng (không lỗi, hết trang): không để lại tiêu đề và chip trên khoảng trống. Ở chip khác khối ở lại để khách còn đường quay về.
  if (categoryId === null && !loadingFirst && !draining && !pages.isError && items.length === 0) return null;

  return (
    <section ref={section} aria-label={homeCopy.suggest.title}>
      <div style={{ padding: '0 16px' }}>
        <SectionHeader title={homeCopy.suggest.title} />
      </div>
      <ScrollRow label={homeCopy.suggest.chipsLabel} style={CHIPS_STYLE}>
        {chips.map((c) => (
          <Chip
            key={c.key}
            selected={active.key === c.key}
            onPress={() => {
              haptic('light');
              setChipKey(c.key);
            }}
          >
            {c.label}
          </Chip>
        ))}
      </ScrollRow>
      <div style={{ padding: '0 16px' }}>
        {/* Chưa tới gần màn thì chưa phải "đang tải": không vẽ khung chờ (nó nằm dưới màn, khách không thấy). */}
        {!near ? null : loadingFirst || draining ? (
          <CatalogGridSkeleton count={6} />
        ) : items.length === 0 ? (
          pages.isError ? <HomeBlockError title={homeCopy.suggest.title} error={pages.error} onRetry={pages.refetch} retrying={pages.isFetching} /> : null
        ) : (
          <>
            <CatalogGrid products={items} listSource="home_suggest" />
            <div ref={sentinel} aria-hidden style={{ height: 1 }} />
            {canLoadMore ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
                <Button variant="secondary" loading={isFetchingNextPage} onPress={() => void fetchNextPage()} style={{ minWidth: 160 }}>
                  {homeCopy.suggest.more}
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '16px 0' }}>
                <Text variant="caption" tone="tertiary" as="p" style={{ margin: 0, textAlign: 'center' }}>
                  {homeCopy.suggest.end}
                </Text>
                <Button
                  variant="secondary"
                  onPress={() => {
                    haptic('light');
                    navigate('/browse');
                  }}
                  style={{ minWidth: 160 }}
                >
                  {homeCopy.suggest.enter}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
