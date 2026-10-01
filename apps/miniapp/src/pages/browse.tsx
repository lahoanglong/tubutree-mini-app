import { useEffect, useRef, useState } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useNavigationType } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchBrands, fetchCatalog, type ProductCard, type ProductSuggestion } from '../services/shop-api';
import { getErrorMessage } from '../services/api';
import { trackFilterApplied, trackSearchPerformed, trackSearchResultClicked } from '../services/discovery-events';
import { CartButton } from '../components/cart-button';
import { PullToRefresh } from '../components/pull-to-refresh';
import { CatalogGrid, CatalogGridSkeleton } from '../components/catalog/catalog-grid';
import { CategoryGrid } from '../components/catalog/category-grid';
import { FilterSheet } from '../components/catalog/filter-sheet';
import { RecentlyViewedRail } from '../components/catalog/recently-viewed-rail';
import { ResultHeader } from '../components/catalog/result-header';
import { SortChips } from '../components/catalog/sort-chips';
import { SuggestList } from '../components/catalog/suggest-list';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { SearchField } from '../components/ui/search-field';
import { segmentLabel, useCategories, type CategoryEntry } from '../hooks/use-categories';
import { useScrollRestoration } from '../hooks/use-scroll-restoration';
import { useSearchState } from '../hooks/use-search-state';
import { useSuggest } from '../hooks/use-suggest';
import { vi } from '../i18n/vi';
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from '../utils/recent-searches';
import { forgetTrackedSearch, shouldTrackSearch } from '../utils/search-tracking';
import {
  CLEAR_SEARCH_PATCH, activeFilterChips, activeFilterCount, changedFilterTypes, isBrowseRoot, toCatalogQuery, type FilterDraft,
} from '../utils/search-state';

const PAGE_LIMIT = 30;

/**
 * Trang Danh mục / Tìm kiếm (spec 5b.2) — DS v2. Toàn bộ trạng thái (q, sắp xếp, lọc, danh mục,
 * phân khúc, thương hiệu) nằm trong URL (`useSearchState`, replace) → quay lại từ PDP giữ nguyên,
 * vị trí cuộn khôi phục theo khoá URL. Gõ chỉ hiện GỢI Ý; Enter / chạm gợi ý mới ghi `q`.
 *
 * Khôi phục cuộn: `anchorRef` luôn được vẽ (không đặt sau điều kiện) và `ready` = trang 1 của danh sách
 * đã vẽ VÀ không đang ở chế độ gõ (gợi ý thay nội dung → trang ngắn, trình duyệt sẽ kẹp vị trí về gần 0
 * và lượt khôi phục duy nhất bị dùng mất). Vị trí đã lưu có thể sâu hơn trang 1 (khách đã bấm "Xem thêm"):
 * quay lại trong lúc cache React Query còn (gcTime mặc định 5 phút) thì MỌI trang đã tải vẫn hiện ngay
 * nên khôi phục đủ sâu; hết cache thì chỉ có trang 1 và trình duyệt kẹp vị trí về cuối trang 1 —
 * chấp nhận (không tải ngầm hàng loạt trang chỉ để cuộn).
 */
export default function BrowsePage() {
  const navigate = useNavigate();
  const { state, urlKey, focusSearch, update, consumeFocus } = useSearchState();
  const inputRef = useRef<HTMLInputElement>(null);

  // Ô nhập theo `q` của URL mỗi khi URL đổi từ ngoài (Back, chạm từ khoá) — đặt trong render, không qua effect.
  const [draft, setDraft] = useState(state.q);
  const [syncedQ, setSyncedQ] = useState(state.q);
  if (syncedQ !== state.q) {
    setSyncedQ(state.q);
    setDraft(state.q);
  }
  const [editing, setEditing] = useState(focusSearch);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches());

  // Ô tìm ở Trang chủ chỉ là vỏ dẫn sang đây (?focus=search): focus thẳng ô thật rồi bỏ cờ khỏi URL
  // — quay lại từ PDP sẽ không bật bàn phím lần nữa (plan 4b Ruling 7).
  useEffect(() => {
    if (!focusSearch) return;
    inputRef.current?.focus();
    setEditing(true);
    consumeFocus();
  }, [focusSearch, consumeFocus]);

  // Brand/category đổi chậm (sync Pancake ~15p/lần) → cache 60s.
  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands, staleTime: 60_000 });
  const categories = useCategories();
  // Chỉ gợi ý khi khách đang gõ: vào thẳng /browse?q=… (link, Back) không được bắn request gợi ý.
  const suggest = useSuggest(editing ? draft : '');

  const products = useInfiniteQuery({
    queryKey: ['products', 'browse', urlKey],
    queryFn: ({ pageParam }) => fetchCatalog(toCatalogQuery(state, pageParam, PAGE_LIMIT)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
  });
  const firstPage = products.data?.pages[0];
  const list = products.data?.pages.flatMap((pg) => pg.data) ?? [];

  // `search_performed` (quy tắc ở utils/search-tracking): mỗi khoá tìm ghi một lần. Trang Browse bị gỡ khi mở
  // PDP và mount lại khi Back với trang 1 còn trong cache — đó KHÔNG phải lượt tìm mới. Mở mới bằng PUSH
  // (khách chủ động mở lại, kể cả cùng từ khoá) thì quên khoá cũ; effect này khai báo TRƯỚC effect ghi nên chạy trước.
  const mountedByPop = useRef(useNavigationType() === 'POP');
  useEffect(() => {
    if (!mountedByPop.current) forgetTrackedSearch();
  }, []);
  // Phụ thuộc PHẦN TỬ trang 1, không phải cả mảng `pages` — "Xem thêm" tạo mảng mới mà trang 1 giữ
  // nguyên tham chiếu (review 2026-09-28); khoá ghi nhớ còn chặn cả làm mới nền đổi tham chiếu trang 1.
  useEffect(() => {
    if (!state.q) {
      forgetTrackedSearch(); // xoá từ khoá rồi gõ lại đúng từ khoá cũ vẫn là lượt tìm mới
      return;
    }
    if (!firstPage) return;
    if (shouldTrackSearch(urlKey)) trackSearchPerformed({ q: state.q, resultsCount: firstPage.meta.total });
  }, [state.q, urlKey, firstPage]);

  // Chế độ gõ chỉ thay nội dung bằng gợi ý khi có gì để gợi ý (đang gõ chữ, hoặc ô trống nhưng có lịch sử tìm);
  // khách mới bấm vào ô trống vẫn thấy nguyên Danh mục/danh sách thay vì một trang trắng.
  const showSuggest = editing && (draft.trim() !== '' || recent.length > 0);

  const { anchorRef } = useScrollRestoration(urlKey, !showSuggest && list.length > 0);

  const stopEditing = () => {
    setEditing(false);
    inputRef.current?.blur();
  };
  const commit = (term: string) => {
    const t = term.trim();
    stopEditing();
    setDraft(t);
    if (t.length >= 2) setRecent(pushRecentSearch(t));
    update({ q: t });
  };
  const pickCategory = (e: CategoryEntry) => {
    stopEditing();
    update(e.kind === 'category' ? { category: e.key, segment: undefined, q: '' } : { segment: e.key, category: undefined, q: '' });
  };
  const pickSuggestion = (p: ProductSuggestion, index: number) => {
    trackSearchResultClicked({ q: draft.trim(), position: index + 1, source: 'suggest', slug: p.slug });
    stopEditing();
    navigate(`/product/${p.slug}`, { state: { listSource: 'search_suggest' } });
  };
  const openResult = (p: ProductCard, index: number) => {
    if (state.q) trackSearchResultClicked({ q: state.q, position: index + 1, source: 'results', slug: p.slug });
  };
  const applyFilters = (d: FilterDraft) => {
    for (const t of changedFilterTypes(state, d)) trackFilterApplied(t);
    setFiltersOpen(false);
    update({ brands: d.brands, minPrice: d.minPrice, maxPrice: d.maxPrice, inStock: d.inStock, minRating: d.minRating });
  };

  const root = isBrowseRoot(state);
  const categoryName = state.category ? categories.categories.find((c) => c.id === state.category)?.name : undefined;
  const chips = activeFilterChips(state, { categoryName, segmentName: state.segment ? segmentLabel(state.segment) : undefined });
  const noResults = !products.isLoading && !products.isError && list.length === 0;

  return (
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 72 }}>
      <PullToRefresh onRefresh={() => Promise.all([products.refetch(), brands.refetch()])} />
      <div ref={anchorRef} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 8px' }}>
        <SearchField
          ref={inputRef}
          value={draft}
          onChange={setDraft}
          onSubmit={commit}
          onFocus={() => setEditing(true)}
          onClear={() => {
            setDraft('');
            if (state.q) update({ q: '' });
          }}
          label={vi.browse.searchLabel}
          clearLabel={vi.browse.clearSearch}
          placeholder={vi.browse.searchPlaceholder}
        />
        {editing ? (
          <Button
            variant="ghost"
            onPress={() => {
              stopEditing();
              setDraft(state.q);
            }}
            style={{ minWidth: 0, padding: '0 8px' }}
          >
            {vi.common.cancel}
          </Button>
        ) : (
          <CartButton />
        )}
      </div>

      {showSuggest ? (
        <SuggestList
          draft={draft}
          recent={recent}
          categories={categories.entries}
          products={suggest.products}
          loading={suggest.isFetching}
          onPickKeyword={commit}
          onPickCategory={pickCategory}
          onPickProduct={pickSuggestion}
          onClearRecent={() => {
            clearRecentSearches();
            setRecent([]);
          }}
        />
      ) : (
        <>
          {root && (
            <CategoryGrid
              entries={categories.entries}
              isLoading={categories.isLoading}
              placeholderCount={categories.placeholderCount}
              onSelect={pickCategory}
            />
          )}
          {root && <RecentlyViewedRail />}
          <SortChips value={state.sort} onChange={(sort) => update({ sort })} />
          <ResultHeader
            total={firstPage?.meta.total ?? 0}
            isLoading={products.isLoading}
            chips={chips}
            filterCount={activeFilterCount(state)}
            filtersIgnored={firstPage?.filtersIgnored ?? false}
            onOpenFilters={() => setFiltersOpen(true)}
            onPatch={update}
          />
          <div style={{ padding: '0 16px 24px' }}>
            {products.isLoading ? (
              <CatalogGridSkeleton count={6} />
            ) : products.isError && list.length === 0 ? (
              <ErrorState message={getErrorMessage(products.error)} onRetry={() => void products.refetch()} />
            ) : list.length === 0 ? (
              <EmptyState
                art={state.q ? 'search' : 'leaf'}
                heading={state.q ? vi.browse.noResultHeading(state.q) : root ? vi.browse.emptyHeading : vi.browse.noResultFiltered}
                body={root ? vi.browse.emptyBody : vi.browse.noResultBody}
                ctaLabel={root ? undefined : vi.browse.clearAll}
                onCta={root ? undefined : () => update(CLEAR_SEARCH_PATCH)}
              />
            ) : (
              <>
                <CatalogGrid products={list} listSource={state.q ? 'search' : 'browse'} onOpen={openResult} />
                {/* Lỗi khi ĐÃ có dữ liệu ("Xem thêm" hoặc làm mới nền thất bại): giữ nguyên danh sách, báo và thử lại tại chỗ. */}
                {products.isError && (
                  <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 16 }}>
                    <Text variant="body-sm" tone="danger">
                      {vi.browse.loadMoreFailed}
                    </Text>
                    <Button
                      variant="secondary"
                      loading={products.isFetching}
                      onPress={() => {
                        (products.isFetchNextPageError ? products.fetchNextPage() : products.refetch()).catch(() => undefined);
                      }}
                      style={{ minWidth: 0 }}
                    >
                      {vi.common.retry}
                    </Button>
                  </div>
                )}
                {products.hasNextPage && !products.isFetchNextPageError && (
                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 16 }}>
                    <Button
                      variant="secondary"
                      loading={products.isFetchingNextPage}
                      onPress={() => {
                        products.fetchNextPage().catch(() => undefined);
                      }}
                      style={{ minWidth: 160 }}
                    >
                      {vi.browse.loadMore}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          {/* Tìm/lọc không ra gì → vẫn cho khách lối đi tiếp ("Đã xem gần đây" tự ẩn khi chưa xem gì). Đặt NGOÀI
              khối đệm 16px vì dải tự có đệm ngang; ở trang gốc dải đã hiện phía trên lưới. */}
          {noResults && !root && <RecentlyViewedRail />}
        </>
      )}

      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} state={state} brands={brands.data ?? []} onApply={applyFilters} />
    </Page>
  );
}
