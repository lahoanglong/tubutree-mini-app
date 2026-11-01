import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { ChevronRight } from 'lucide-react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { findCategory, chipScope } from '@tubutree/app-core/browse/category-tree';
import { scrollDeltaToListTop } from '@tubutree/app-core/browse/scroll';
import { browseSortOptions, sortForTab, sortTab, type SortTab } from '@tubutree/app-core/browse/sort';
import { fetchActiveFlashSales, fetchBrands, fetchCatalog, type ProductCard, type ProductSuggestion } from '../services/shop-api';
import { getLoadErrorMessage } from '../services/api';
import { trackFilterApplied, trackSearchPerformed, trackSearchResultClicked } from '../services/discovery-events';
import { CartButton } from '../components/cart-button';
import { PullToRefresh } from '../components/pull-to-refresh';
import { ActiveFilters } from '../components/catalog/active-filters';
import { BrowseHub } from '../components/catalog/browse-hub';
import { CatalogGrid, CatalogGridSkeleton } from '../components/catalog/catalog-grid';
import { CategoryChipRow } from '../components/catalog/category-chip-row';
import { FilterSheet } from '../components/catalog/filter-sheet';
import { ListHeading } from '../components/catalog/list-heading';
import { RecentlyViewedRail } from '../components/catalog/recently-viewed-rail';
import { SuggestList } from '../components/catalog/suggest-list';
import { Button } from '../components/ui/button';
import { SortBar } from '../components/ui/sort-bar';
import { SR_ONLY } from '../components/ui/sr-only';
import { Text } from '../components/ui/text';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { SearchField } from '../components/ui/search-field';
import { segmentLabel, useCategories, type CategoryEntry } from '../hooks/use-categories';
import { useNavigationType } from '../hooks/use-navigation-type';
import { useScrollRestoration } from '../hooks/use-scroll-restoration';
import { useSearchState } from '../hooks/use-search-state';
import { useSuggest } from '../hooks/use-suggest';
import { vi } from '../i18n/vi';
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from '../utils/recent-searches';
import { uniqueById } from '../utils/unique-by-id';
import { forgetTrackedSearch, shouldTrackSearch } from '../utils/search-tracking';
import {
  CLEAR_SEARCH_PATCH, EMPTY_SEARCH_STATE, PAGE_LIMIT, activeFilterChips, activeFilterCount, changedFilterTypes, isBrowseHub, isBrowseRoot,
  serializeSearchState, toCatalogQuery, withListMode, type FilterDraft, type SearchState, type TitleScope,
} from '../utils/search-state';

/** Hàng ô tìm đo được 58px (ô 46px gồm viền + đệm dọc 6px mỗi phía): thanh sắp xếp dính ngay dưới nó (`--sort-bar-top`). */
const SEARCH_ROW_HEIGHT = 58;

// Ô tìm dính đầu trang khi cuộn (dưới vùng an toàn): khách đang xem lưới sâu vẫn tìm hoặc mở giỏ được mà không phải cuộn ngược lên.
const STICKY_SEARCH: CSSProperties = {
  position: 'sticky',
  top: 'var(--safe-top)',
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 16px',
  background: 'var(--color-bg-canvas)',
};

const PAGE_STYLE = {
  background: 'var(--color-bg-canvas)',
  paddingBottom: 72,
  '--sort-bar-top': `calc(var(--safe-top) + ${SEARCH_ROW_HEIGHT}px)`,
} as CSSProperties;

/** Đường dẫn của một trạng thái Danh mục, dùng khi MỞ MỚI từ hub (PUSH: Back về hub). */
const browseHref = (patch: Partial<SearchState>) => `/browse?${serializeSearchState({ ...EMPTY_SEARCH_STATE, ...patch })}`;

/**
 * Trang Danh mục / Tìm kiếm (spec 5b.2) — hai chế độ theo URL. Gốc `/browse` chưa tìm, chưa lọc, chưa `all=1` là HUB (ô danh mục,
 * Đã xem, Bán chạy nhất, thương hiệu; KHÔNG tải danh sách). Có từ khoá, danh mục, bộ lọc, sắp xếp hoặc `all=1` là DANH SÁCH: thanh
 * sắp xếp dính, một tiêu đề + số kết quả, chip danh mục con, lưới 20 món mỗi trang. Toàn bộ trạng thái nằm trong URL
 * (`useSearchState`, replace) → quay lại từ PDP giữ nguyên, vị trí cuộn khôi phục theo khoá URL. Từ hub chạm ô là PUSH (Back về hub).
 * Gõ chỉ hiện GỢI Ý; Enter / chạm gợi ý mới ghi `q`.
 *
 * Khôi phục cuộn: `anchorRef` luôn được vẽ (không đặt sau điều kiện) và `ready` = hub đã vẽ, hoặc trang 1 của danh sách đã vẽ, VÀ không
 * đang ở chế độ gõ (gợi ý thay nội dung → trang ngắn, trình duyệt sẽ kẹp vị trí về gần 0 và lượt khôi phục duy nhất bị dùng mất).
 * Vị trí đã lưu có thể sâu hơn trang 1 (khách đã bấm "Xem thêm"): quay lại trong lúc cache React Query còn (gcTime mặc định 5 phút)
 * thì MỌI trang đã tải vẫn hiện ngay nên khôi phục đủ sâu; hết cache thì chỉ có trang 1 và trình duyệt kẹp vị trí về cuối trang 1 —
 * chấp nhận (không tải ngầm hàng loạt trang chỉ để cuộn).
 */
export default function BrowsePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state, urlKey, focusSearch, update, consumeFocus } = useSearchState();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRowRef = useRef<HTMLDivElement>(null);
  const listTopRef = useRef<HTMLDivElement>(null);
  const hubState = isBrowseHub(state);
  /**
   * Kéo về đầu danh sách (thanh sắp xếp vừa chạm thanh dính) nếu khách đang cuộn sâu hơn. Thanh sắp xếp dính nên khách đổi sắp xếp hay lọc
   * ngay giữa lưới; lưới đổi sang khung chờ ngắn, trình duyệt kẹp vị trí về giữa trang và hai hàng đầu nằm khuất dưới hai thanh dính. Cuộn
   * TRƯỚC khi ghi URL; đổi bằng replace nên hook khôi phục cuộn không tự đưa về đầu.
   */
  const scrollToListTop = () => {
    const sentinel = listTopRef.current;
    const stuck = searchRowRef.current;
    const scroller = sentinel?.closest<HTMLElement>('.zaui-page');
    if (!sentinel || !stuck || !scroller) return;
    const delta = scrollDeltaToListTop(sentinel.getBoundingClientRect().top, stuck.getBoundingClientRect().bottom);
    if (delta !== 0) scroller.scrollTop += delta;
  };
  /** Mọi thay đổi khi đã ở danh sách: ở lại danh sách (gỡ chip cuối, về "Phổ biến" không đẩy khách về hub) và về đầu danh sách. */
  const updateList = (patch: Partial<SearchState>) => {
    scrollToListTop();
    update(withListMode(patch));
  };

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

  // Hub không tải danh sách: `enabled` chặn cả lần tải đầu lẫn `refetch` tự động.
  const products = useInfiniteQuery({
    queryKey: ['products', 'browse', urlKey],
    queryFn: ({ pageParam }) => fetchCatalog(toCatalogQuery(state, pageParam, PAGE_LIMIT)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    enabled: !hubState,
  });
  const firstPage = products.data?.pages[0];
  const list = uniqueById(products.data?.pages.flatMap((pg) => pg.data) ?? []);

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
  // khách mới bấm vào ô trống vẫn thấy nguyên hub/danh sách thay vì một trang trắng.
  const showSuggest = editing && (draft.trim() !== '' || recent.length > 0);
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000, enabled: showSuggest });

  const { anchorRef } = useScrollRestoration(urlKey, !showSuggest && (hubState || list.length > 0));

  const stopEditing = () => {
    setEditing(false);
    inputRef.current?.blur();
  };
  // Xong việc với ô tìm mà không gửi gì (chạm chip, "Hủy"): trả ô về `q` đang lọc, không để ô trống/dở dang trong khi lưới vẫn là kết quả của `q`.
  const leaveSearchField = () => {
    stopEditing();
    setDraft(state.q);
  };
  const commit = (term: string) => {
    const t = term.trim();
    stopEditing();
    setDraft(t);
    if (t.length >= 2) setRecent(pushRecentSearch(t));
    scrollToListTop();
    update({ q: t });
  };
  const pickHubCategory = (e: CategoryEntry) => {
    stopEditing();
    navigate(browseHref(e.kind === 'category' ? { category: e.key } : { segment: e.key }));
  };
  // Từ hub (kể cả khi đang gõ gợi ý) là mở MỚI như chạm ô danh mục: PUSH, Back về hub. Trong danh sách thì đổi phạm vi bằng replace.
  const pickCategory = (e: CategoryEntry) => {
    if (hubState) {
      pickHubCategory(e);
      return;
    }
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
    updateList({ brands: d.brands, minPrice: d.minPrice, maxPrice: d.maxPrice, inStock: d.inStock, minRating: d.minRating });
  };

  const hub = hubState;
  const root = isBrowseRoot(state);
  const category = state.category ? findCategory(categories.categories, state.category) : null;
  const categoryName = category?.name;
  const segmentName = state.segment ? segmentLabel(state.segment) : undefined;
  const scope = state.category ? chipScope(categories.categories, state.category) : null;
  const noResults = !products.isLoading && !products.isError && list.length === 0;
  // Đã chọn danh mục, phân khúc hoặc đúng một nhãn thì nói rõ đang xem gì; nhãn công khai có thêm lối sang trang nhãn.
  const singleBrand = state.brands.length === 1 ? state.brands[0]! : null;
  const brandSlug = singleBrand ? (brands.data?.find((b) => b.brand === singleBrand)?.slug ?? null) : null;
  const listTitle = state.q ? null : categoryName ?? segmentName ?? singleBrand;
  // Chỉ phạm vi đang làm tiêu đề (hiện đúng một lần) mới không lặp thành chip; có từ khoá thì tiêu đề nhường chỗ cho ô tìm. Danh mục không có
  // trong cây (link cũ, đã xoá) không làm tiêu đề được: cây đã tải xong thì hiện chip "Danh mục" để khách thấy và gỡ được bộ lọc đó.
  const titleScope: TitleScope | null = !listTitle ? null : categoryName ? 'category' : segmentName ? 'segment' : 'brand';
  const chips = activeFilterChips(
    state,
    { categoryName: categoryName ?? (state.category && !categories.isLoading ? vi.browse.title : undefined), segmentName },
    { titleScope },
  );

  return (
    <Page className="page" style={PAGE_STYLE}>
      <PullToRefresh
        onRefresh={() =>
          Promise.all([
            hub ? queryClient.invalidateQueries({ queryKey: ['products', 'best-sellers'] }) : products.refetch(),
            brands.refetch(),
          ])
        }
      />
      <div ref={anchorRef} />
      <h1 style={SR_ONLY}>{vi.browse.title}</h1>
      <div ref={searchRowRef} data-testid="browse-search-row" style={STICKY_SEARCH}>
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
            onPress={leaveSearchField}
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
          flashSales={flashQ.data}
          loading={suggest.isFetching}
          error={suggest.isError}
          onRetry={suggest.refetch}
          onPickKeyword={commit}
          onPickCategory={pickCategory}
          onPickProduct={pickSuggestion}
          onClearRecent={() => {
            clearRecentSearches();
            setRecent([]);
          }}
        />
      ) : hub ? (
        <BrowseHub
          entries={categories.entries}
          categoriesLoading={categories.isLoading}
          placeholderCount={categories.placeholderCount}
          brands={brands.data}
          onPickCategory={pickHubCategory}
          onPickAll={() => navigate(browseHref({ all: true }))}
          onPickBrand={(brand) => navigate(browseHref({ brands: [brand] }))}
        />
      ) : (
        <>
          <div ref={listTopRef} data-testid="browse-list-top" aria-hidden="true" />
          <SortBar
            sticky
            value={sortTab(state.sort)}
            options={browseSortOptions(state.sort, Boolean(state.q))}
            onChange={(tab) => {
              // Thanh sắp xếp chỉ hiện khi KHÔNG có gợi ý (ô trống, chưa có lịch sử): chạm là xong việc với ô tìm, không để "Hủy" kẹt thay giỏ.
              leaveSearchField();
              updateList({ sort: sortForTab(state.sort, tab as SortTab) });
            }}
            filterCount={activeFilterCount(state)}
            onFilter={() => setFiltersOpen(true)}
          />
          <ListHeading
            title={listTitle}
            count={products.isError && list.length === 0 ? undefined : firstPage?.meta.total ?? 0}
            isLoading={products.isLoading}
          />
          {brandSlug && !state.q && (
            <div style={{ padding: '0 16px' }}>
              <button
                type="button"
                className="tubu-press"
                onClick={() => navigate(`/brand/${encodeURIComponent(brandSlug)}`)}
                style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <Text variant="label" tone="brand">
                  {vi.browse.viewBrand(singleBrand!)}
                </Text>
                <ChevronRight size={16} aria-hidden style={{ color: 'var(--color-text-brand)' }} />
              </button>
            </div>
          )}
          {scope && state.category && (
            <CategoryChipRow
              parent={scope.parent}
              chips={scope.chips}
              activeId={state.category}
              onSelect={(id) => {
                leaveSearchField();
                updateList({ category: id, segment: undefined });
              }}
            />
          )}
          <ActiveFilters
            chips={chips}
            filtersIgnored={firstPage?.filtersIgnored ?? false}
            onPatch={(patch) => {
              leaveSearchField();
              updateList(patch);
            }}
          />
          <div style={{ padding: '8px 16px 24px' }}>
            {products.isLoading ? (
              <CatalogGridSkeleton count={6} />
            ) : products.isError && list.length === 0 ? (
              <ErrorState message={getLoadErrorMessage(products.error)} onRetry={() => void products.refetch()} />
            ) : list.length === 0 ? (
              <EmptyState
                art={state.q ? 'search' : 'leaf'}
                heading={state.q ? vi.browse.noResultHeading(state.q) : root ? vi.browse.emptyHeading : vi.browse.noResultFiltered}
                body={root ? vi.browse.emptyBody : vi.browse.noResultBody}
                ctaLabel={root ? undefined : vi.browse.clearAll}
                onCta={root ? undefined : () => updateList(CLEAR_SEARCH_PATCH)}
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
          {/* Tìm/lọc không ra gì → vẫn cho khách lối đi tiếp ("Đã xem gần đây" tự ẩn khi chưa xem gì). */}
          {noResults && <RecentlyViewedRail />}
        </>
      )}

      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} state={state} brands={brands.data ?? []} onApply={applyFilters} />
    </Page>
  );
}
