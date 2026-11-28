import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { mergeSuggestions, SUGGEST_PAGE_SIZE } from '@tubutree/app-core/home-layout';
import { SUGGEST_MAX, vnDateSeed } from '@tubutree/app-core/home-suggest';
import { useNavigationType } from '../../hooks/use-navigation-type';
import { fetchCatalog, fetchForYou } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { serverNow } from '../../utils/server-clock';
import { CatalogGridSkeleton } from '../catalog/catalog-grid';
import { Button } from '../ui/button';
import { SectionHeader } from '../ui/section-header';
import { Text } from '../ui/text';
import { HomeBlockError } from './home-block-error';
import { SuggestGrid } from './suggest-grid';

/** Nút cuối lưới rộng 10rem (nửa khối ở khổ rất hẹp): chữ ngắn ("Xem thêm") không ra nút bé tí giữa khoảng trắng. */
const MORE_BUTTON = { minWidth: 'min(50%, 10rem)' } as const;

export interface SuggestFeedProps {
  /** Slug món đã nằm ở các kệ hàng phía trên: lưới không lặp lại chúng. */
  exclude: ReadonlySet<string>;
  /** Thẻ chen sau `HOME_INTERLEAVE_AFTER` thẻ đầu (dải "Khách hàng sống xanh", không đủ thì thẻ của ngày). Lưới ngắn hơn thì không chen. */
  interleave?: ReactNode;
}

/** Khoá trang 1 của lưới; web dựng sẵn trang này ở server với cùng khoá. */
export const suggestPagesKey = (seed: string) => ['products', 'home-suggest', seed, 'all'] as const;

/**
 * "Gợi ý cho bạn" (W47, khối `suggest` cuối Trang chủ): MỘT lưới 2 cột cuộn dần; duyệt theo thương hiệu nằm ở thanh chip
 * dưới Danh mục và lưới logo ở tab Danh mục. Thứ tự xoay theo ngày Việt Nam (`seed`): cuộn, quay lại, mở lại app trong ngày không xáo lưới.
 * Khách đã đăng nhập thấy gợi ý cá nhân lên đầu. Dừng ở `SUGGEST_MAX` món rồi mời vào Danh mục: cuộn vô tận không có đáy làm khách mất đường tới thanh đáy.
 */
export function SuggestFeed({ exclude, interleave }: SuggestFeedProps) {
  const navigate = useNavigate();
  const navType = useNavigationType();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  // Chốt một lần mỗi lần mở: qua nửa đêm giữa chừng không đổi thứ tự dưới chân khách.
  const seed = useMemo(() => vnDateSeed(serverNow()), []);
  const [popped] = useState(() => navType === 'POP');

  // Lưới nằm cuối Trang chủ: chỉ tải khi khối cách màn hình chưa tới một màn (mở Trang chủ không bắn request của khối cuối trang, C-037).
  const section = useRef<HTMLElement>(null);
  // Back từ PDP: trang 1 đã có trong cache thì dựng lưới ngay (không chờ IntersectionObserver) để trang đủ cao cho hook khôi phục cuộn.
  const queryClient = useQueryClient();
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined' || (popped && queryClient.getQueryData(suggestPagesKey(seed)) !== undefined));
  useEffect(() => {
    const el = section.current;
    if (near || !el) return;
    // Trang Mini cuộn trong `.zaui-page` (khung cắt nội dung): lấy chính khung cuộn làm gốc để "cách một màn hình" đúng nghĩa.
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      root: el.closest('.zaui-page'),
      rootMargin: '100% 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const forYou = useQuery({ queryKey: ['for-you', seed], queryFn: () => fetchForYou({ seed }), enabled: near && authed });
  const pages = useInfiniteQuery({
    queryKey: suggestPagesKey(seed),
    queryFn: ({ pageParam }) => fetchCatalog({ page: pageParam, limit: SUGGEST_PAGE_SIZE, seed }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    enabled: near,
  });
  const personal = authed ? (forYou.data ?? []) : [];
  const fresh = mergeSuggestions(personal, (pages.data?.pages ?? []).map((p) => p.data)).filter((p) => !exclude.has(p.slug));
  const capped = fresh.length >= SUGGEST_MAX;
  const items = capped ? fresh.slice(0, SUGGEST_MAX) : fresh;
  const loadingFirst = !near || pages.isLoading || (authed && forYou.isPending && !pages.data);

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const canLoadMore = hasNextPage && !capped;
  // Trang sau tải lỗi thì không tự tải lại khi sentinel còn trong khung (lặp request mỗi lần dựng lại); nút "Xem thêm" là lối thử lại.
  const autoLoad = canLoadMore && !pages.isFetchNextPageError;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !autoLoad || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { root: el.closest('.zaui-page'), rootMargin: '50% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoLoad, isFetchingNextPage, fetchNextPage, items.length]);

  // Cả trang đã tải đều là món nằm ở kệ trên: lưới rỗng nhưng còn trang sau, nên tải tiếp (không có gì trên màn để cuộn tới thì không có sentinel chạm) thay vì ẩn khối.
  const draining = items.length === 0 && !!hasNextPage && !pages.isError;
  useEffect(() => {
    if (draining && !isFetchingNextPage) void fetchNextPage();
  }, [draining, isFetchingNextPage, fetchNextPage]);

  // Tải xong mà rỗng (không lỗi, hết trang): không để lại tiêu đề trên khoảng trống.
  if (near && !loadingFirst && !draining && !pages.isError && items.length === 0) return null;

  const toBrowse = () => {
    haptic('light');
    navigate('/browse');
  };
  return (
    <section ref={section} aria-label={homeCopy.suggest.title} data-testid="home-suggest" style={{ padding: '0 var(--space-inset-page)' }}>
      <SectionHeader title={homeCopy.suggest.title} />
      {/* Chưa tới gần màn thì chưa phải "đang tải": không vẽ khung chờ (nó nằm dưới màn, khách không thấy). */}
      {!near ? null : loadingFirst || draining ? (
        <CatalogGridSkeleton count={6} />
      ) : items.length === 0 ? (
        <HomeBlockError title={homeCopy.suggest.title} error={pages.error} onRetry={pages.refetch} retrying={pages.isFetching} />
      ) : (
        <>
          <SuggestGrid products={items} listSource="home_suggest" interleave={interleave} />
          <div ref={sentinel} aria-hidden style={{ height: 1 }} />
          {canLoadMore ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-stack-md) 0' }}>
              <Button variant="secondary" loading={isFetchingNextPage} onPress={() => void fetchNextPage()} style={MORE_BUTTON}>
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
