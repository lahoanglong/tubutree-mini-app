'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronRight, Leaf, Search, X } from 'lucide-react';
import type { CatalogPage, CategoryDTO, ProductCard as ProductCardData, ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { categoryTrail, chipScope, findCategory } from '@tubutree/app-core/browse/category-tree';
import { scrollDeltaToListTop } from '@tubutree/app-core/browse/scroll';
import { browseSortOptions, sortForTab, sortTab, type SortTab } from '@tubutree/app-core/browse/sort';
import { brandsQuery, browseQuery, categoriesQuery } from '@tubutree/app-core/queries/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { browseText } from '@/lib/browse-text';
import { categoryEntries, segmentLabel, type CategoryEntry } from '@/lib/browse-categories';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from '@/lib/recent-searches';
import {
  BROWSE_PATH, CLEAR_SEARCH_PATCH, EMPTY_SEARCH_STATE, PAGE_LIMIT, activeFilterChips, activeFilterCount, browseHref, isBrowseHub, isBrowseRoot,
  toCatalogQuery, withListMode, type FilterDraft, type SearchState, type TitleScope,
} from '@/lib/search-state';
import { useBrowseState } from '@/lib/use-browse-state';
import { useSuggest } from '@/lib/use-suggest';
import { GRID_PRODUCTS_WITH_FILTER } from '@/lib/product-grid';
import { PRIORITY_CARDS, ProductGrid, SortBar } from '@/components/mini';
import { ListingBreadcrumb, ListingLayout, type BreadcrumbItem } from '@/components/layouts/listing-layout';
import { ErrorState } from '@/components/ui/error-state';
import { ProductGridSkeleton } from '@/components/ui/skeleton';
import { BrowsePager } from './browse-pager';
import { PhoneCartButton } from '@/components/phone-cart-button';
import { phoneBrandText } from '@/lib/phone-ui';
import { ActiveFilters } from './active-filters';
import { BrowseHub } from './browse-hub';
import { CategoryChipRow } from './category-chip-row';
import { FilterSheet } from './filter-sheet';
import { FilterSidebar } from './filter-sidebar';
import { ListHeading } from './list-heading';
import { RecentlyViewedRail } from './recently-viewed-rail';
import { SuggestList } from './suggest-list';
import { loadErrorText } from '@/lib/error-text';
import { announcePdpNavigation } from '@/components/skeletons/pdp-nav-event';


/** Danh sách đã tải phía server cho đúng URL ban đầu: hiện ngay (và cho crawler) rồi React Query tiếp quản. */
export interface BrowseInitial {
  urlKey: string;
  page: CatalogPage;
  startPage: number;
}

export interface BrowseViewProps {
  initial?: BrowseInitial | null;
  brands?: { brand: string; count: number; slug?: string | null }[];
  categories?: CategoryDTO[];
  /** Kệ Bán chạy nhất của hub do server tải sẵn. */
  bestSellers?: ProductCardData[];
}

const uniqueById = (list: ProductCardData[]) => {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
};

const errorMessage = loadErrorText;

/**
 * Trang Danh mục / Tìm kiếm của web, cùng hành vi với pages/browse.tsx của Mini App, hai chế độ theo URL. Gốc `/san-pham` chưa tìm,
 * chưa lọc, chưa `all=1` và đang ở trang 1 là HUB (ô danh mục, Đã xem, Bán chạy nhất, thương hiệu; KHÔNG tải danh sách). Có từ khoá,
 * danh mục, bộ lọc, sắp xếp, `all=1` hoặc `?page` từ 2 là DANH SÁCH: SortBar dính, một tiêu đề + số kết quả, chip danh mục con, lưới
 * 20 món mỗi trang. Toàn bộ trạng thái nằm trong URL (`useBrowseState`): từ hub chạm ô là PUSH (Back về hub), trong danh sách là
 * replace. Gõ chỉ hiện GỢI Ý; Enter hoặc chạm gợi ý mới ghi `q`.
 */
export default function BrowseView({ initial = null, brands: initialBrands, categories: initialCategories, bestSellers }: BrowseViewProps) {
  const router = useRouter();
  const { state, urlKey, focusSearch, page, update, consumeFocus } = useBrowseState();
  const inputRef = useRef<HTMLInputElement>(null);
  const hubState = isBrowseHub(state, page);
  const listTopRef = useRef<HTMLDivElement>(null);
  const sortStickyRef = useRef<HTMLDivElement>(null);
  /**
   * Kéo về đầu danh sách (thanh sắp xếp vừa chạm vạch dính) nếu khách đang cuộn sâu hơn. Thanh sắp xếp dính nên khách đổi sắp xếp hay lọc
   * ngay giữa lưới; `router.replace(..., { scroll: false })` giữ nguyên vị trí trong khi lưới đổi sang khung chờ ngắn hơn, nên hai hàng đầu
   * (món rẻ nhất, bán chạy nhất) nằm khuất dưới thanh dính, hoặc thấy vùng trống cạnh cột lọc ở lg. Cuộn TRƯỚC khi ghi URL.
   */
  const scrollToListTop = () => {
    const sentinel = listTopRef.current;
    const sticky = sortStickyRef.current;
    if (!sentinel || !sticky) return;
    const stuckTop = parseFloat(getComputedStyle(sticky).top);
    const delta = scrollDeltaToListTop(sentinel.getBoundingClientRect().top, Number.isFinite(stuckTop) ? stuckTop : 0);
    if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' });
  };
  /** Mọi thay đổi khi đã ở danh sách: ở lại danh sách (gỡ chip cuối, về "Phổ biến" không đẩy khách về hub) và về đầu danh sách. */
  const updateList = (patch: Partial<SearchState>) => {
    scrollToListTop();
    update(withListMode(patch));
  };
  const gridRef = useRef<HTMLDivElement>(null);
  /** Số thẻ trước khi "Xem thêm": thẻ đầu của trang mới nhận focus khi dữ liệu về (không mất vị trí đang đọc). */
  const focusFrom = useRef<number | null>(null);

  // Ô nhập theo `q` của URL mỗi khi URL đổi từ ngoài (Back, chạm từ khoá) — đặt trong render, không qua effect.
  const [draft, setDraft] = useState(state.q);
  const [syncedQ, setSyncedQ] = useState(state.q);
  if (syncedQ !== state.q) {
    setSyncedQ(state.q);
    setDraft(state.q);
  }
  const [editing, setEditing] = useState(focusSearch);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // localStorage chỉ có phía trình duyệt: đọc sau hydrate để HTML server và lần vẽ đầu của client giống nhau.
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecentSearches()), []);

  // `?focus=search` từ ô tìm ở trang chủ: focus thẳng ô thật rồi bỏ cờ khỏi URL, để quay lại không bật bàn phím lần nữa.
  useEffect(() => {
    if (!focusSearch) return;
    inputRef.current?.focus();
    setEditing(true);
    consumeFocus();
  }, [focusSearch, consumeFocus]);

  const brandsQ = useQuery({ ...brandsQuery(coreHttp), staleTime: 60_000, ...(initialBrands ? { initialData: initialBrands } : {}) });
  const categoriesQ = useQuery({
    ...categoriesQuery(coreHttp),
    staleTime: 60_000,
    retry: false,
    ...(initialCategories ? { initialData: initialCategories } : {}),
  });
  const entries = categoryEntries(categoriesQ.data);
  // Chỉ gợi ý khi khách đang gõ: vào thẳng /san-pham?q=… (link, Back) không được bắn request gợi ý.
  const suggest = useSuggest(editing ? draft : '');

  const seeded = initial !== null && initial.urlKey === urlKey && initial.startPage === page ? initial : null;
  // Danh sách seed bắt đầu từ trang > 1 thì khoá riêng: khi gỡ bộ lọc về đúng urlKey cũ, không dùng lại mục cache thiếu các trang đầu.
  const startPage = seeded?.startPage ?? page;
  const listKey = startPage > 1 ? `${urlKey}#p${startPage}` : urlKey;
  const products = useInfiniteQuery({
    ...browseQuery(coreHttp, listKey, (page) => toCatalogQuery(state, page, PAGE_LIMIT)),
    initialPageParam: startPage,
    getNextPageParam: (last: CatalogPage) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    ...(seeded ? { initialData: { pages: [seeded.page], pageParams: [seeded.startPage] }, staleTime: 60_000 } : {}),
    // Hub không tải danh sách: `enabled` chặn cả lần tải đầu lẫn `refetch` tự động.
    enabled: !hubState,
  });
  const firstPage = products.data?.pages[0];
  const list = uniqueById(products.data?.pages.flatMap((pg) => pg.data) ?? []);
  const listLength = list.length;
  const fetchingMore = products.isFetchingNextPage;
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || fetchingMore) return;
    focusFrom.current = null;
    if (listLength > from) gridRef.current?.querySelector<HTMLElement>(`ul[data-testid="catalog-grid"] li:nth-child(${from + 1}) a`)?.focus();
  }, [listLength, fetchingMore]);
  const loadMore = () => {
    // aria-disabled không chặn click như `disabled`: bỏ qua lần bấm khi đang tải để không gọi hai trang cùng lúc.
    if (products.isFetchingNextPage) return;
    focusFrom.current = list.length;
    products.fetchNextPage().catch(() => {
      focusFrom.current = null;
    });
  };

  // Chế độ gõ chỉ thay nội dung bằng gợi ý khi có gì để gợi ý (đang gõ chữ, hoặc ô trống nhưng có lịch sử tìm); khách mới
  // bấm vào ô trống vẫn thấy nguyên Danh mục/danh sách thay vì một trang trắng.
  const showSuggest = editing && (draft.trim() !== '' || recent.length > 0);

  const stopEditing = () => {
    setEditing(false);
    inputRef.current?.blur();
  };
  // Xong việc với ô tìm mà không gửi gì (chạm chip, "Hủy"): trả ô về `q` đang lọc, không để ô dở dang khi lưới vẫn là kết quả của `q`.
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
  /** Mở MỚI từ hub: PUSH, để Back về hub (trong danh sách mọi thay đổi là replace). */
  const openFromHub = (patch: Partial<SearchState>) => {
    stopEditing();
    router.push(browseHref({ ...EMPTY_SEARCH_STATE, ...patch }));
  };
  const pickHubCategory = (e: CategoryEntry) => openFromHub(e.kind === 'category' ? { category: e.key } : { segment: e.key });
  // Từ hub (kể cả khi đang gõ gợi ý) là mở MỚI như chạm ô danh mục: PUSH, Back về hub. Trong danh sách thì đổi phạm vi bằng replace.
  const pickCategory = (e: CategoryEntry) => {
    if (hubState) {
      pickHubCategory(e);
      return;
    }
    stopEditing();
    scrollToListTop();
    update(e.kind === 'category' ? { category: e.key, segment: undefined, q: '' } : { segment: e.key, category: undefined, q: '' });
  };
  const pickSuggestion = (p: ProductSuggestion) => {
    stopEditing();
    const href = `/san-pham/${encodeURIComponent(p.slug)}`;
    announcePdpNavigation(href);
    router.push(href);
  };
  const applyFilters = (d: FilterDraft) => {
    setFiltersOpen(false);
    updateList({ brands: d.brands, minPrice: d.minPrice, maxPrice: d.maxPrice, inStock: d.inStock, minRating: d.minRating });
  };

  const root = isBrowseRoot(state);
  const categoryName = state.category ? findCategory(categoriesQ.data, state.category)?.name : undefined;
  const segmentName = state.segment ? segmentLabel(state.segment) : undefined;
  const noResults = !products.isLoading && !products.isError && list.length === 0;
  const singleBrand = state.brands.length === 1 ? state.brands[0]! : null;
  const listTitle = state.q ? null : (categoryName ?? segmentName ?? singleBrand);
  // Chỉ phạm vi đang làm tiêu đề (hiện đúng một lần) mới không lặp thành chip; có từ khoá thì tiêu đề nhường chỗ cho ô tìm. Danh mục không có
  // trong cây (link cũ, đã xoá) không làm tiêu đề được: cây đã tải xong thì hiện chip "Danh mục" để khách thấy và gỡ được bộ lọc đó.
  const titleScope: TitleScope | null = !listTitle ? null : categoryName ? 'category' : segmentName ? 'segment' : 'brand';
  const chips = activeFilterChips(
    state,
    { categoryName: categoryName ?? (state.category && !categoriesQ.isLoading ? browseText.title : undefined), segmentName },
    { titleScope },
  );
  const scope = state.category ? chipScope(categoriesQ.data, state.category) : null;
  // Trang thương hiệu (/brand/:slug) chỉ có khi thương hiệu đã công khai; đây là liên kết duy nhất dẫn tới nó từ danh mục.
  const brandSlug = singleBrand ? (brandsQ.data?.find((b) => b.brand === singleBrand)?.slug ?? null) : null;
  // h1 từ md: tên đang xem (danh mục chưa biết tên thì "Danh mục", không nhận nhầm là "Tất cả sản phẩm").
  const h1Text = hubState
    ? browseText.title
    : state.q
      ? fillCopy('browse.resultsFor', { q: state.q })
      : (listTitle ?? (state.category || state.segment ? browseText.title : fillCopy('browse.allTitle')));
  const nodes = state.category && !state.q ? categoryTrail(categoriesQ.data, state.category) : [];
  const trail: BreadcrumbItem[] = [
    { label: fillCopy('browse.crumbHome'), href: '/' },
    { label: browseText.title, href: hubState ? undefined : BROWSE_PATH },
    ...(hubState
      ? []
      : nodes.length > 0
        ? nodes.map((n, i) => ({ label: n.name, href: i < nodes.length - 1 ? `${BROWSE_PATH}?category=${encodeURIComponent(n.id)}` : undefined }))
        : [{ label: h1Text }]),
  ];
  const lastPageMeta = products.data?.pages.at(-1)?.meta;
  const totalPages = lastPageMeta ? Math.max(1, Math.ceil(lastPageMeta.total / (lastPageMeta.limit || PAGE_LIMIT))) : page;

  const searchForm = (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        commit(draft);
      }}
      className="flex items-center gap-2 pb-2 max-md:sticky max-md:top-0 max-md:z-20 max-md:-mx-4 max-md:bg-[var(--color-bg-canvas)] max-md:px-4 max-md:py-1.5 lg:max-w-2xl"
    >
      <div className="relative min-w-0 flex-1">
        <label htmlFor="browse-q" className="sr-only">
          {browseText.searchLabel}
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
        <input
          ref={inputRef}
          id="browse-q"
          type="search"
          name="q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setEditing(true)}
          maxLength={100}
          placeholder={browseText.searchPlaceholder}
          autoComplete="off"
          enterKeyHint="search"
          className={`${ui.field} pl-9 pr-11 max-md:h-[46px] max-md:rounded-full max-md:border-[var(--color-border-subtle)]`}
        />
        {draft !== '' && (
          <button
            type="button"
            aria-label={browseText.clearSearch}
            onClick={() => {
              setDraft('');
              if (state.q) update({ q: '' });
              inputRef.current?.focus();
            }}
            className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-stone-600"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {editing ? (
        <button type="button" onClick={leaveSearchField} className={`${ui.btnText} ${phoneBrandText}`}>
          {browseText.cancel}
        </button>
      ) : (
        <PhoneCartButton />
      )}
    </form>
  );

  const showList = !showSuggest && !hubState;

  return (
    // `--sort-bar-top`: SortBar dính ngay dưới hàng ô tìm dính ở điện thoại (58px = 46 ô tìm + 2x6 đệm, số đo của Mini App), dưới thanh đầu từ md. Phải là chuỗi lớp nguyên văn để Tailwind thấy.
    <div data-browse-scope className="max-md:[--sort-bar-top:58px] md:[--sort-bar-top:var(--header-h)]">
      <ListingLayout
        breadcrumb={<ListingBreadcrumb trail={trail} />}
        title={h1Text}
        toolbar={searchForm}
        sidebar={
          showList ? (
            <FilterSidebar
              state={state}
              entries={entries}
              tree={categoriesQ.data}
              brands={brandsQ.data ?? []}
              onPickCategory={pickCategory}
              onClearCategory={() => {
                leaveSearchField();
                updateList({ category: undefined, segment: undefined });
              }}
              onPatch={(patch) => {
                leaveSearchField();
                updateList(patch);
              }}
            />
          ) : undefined
        }
      >
        {showSuggest ? (
          <SuggestList
            draft={draft}
            recent={recent}
            categories={entries}
            products={suggest.products}
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
        ) : hubState ? (
          <BrowseHub
            entries={entries}
            categoriesLoading={categoriesQ.isLoading}
            brands={brandsQ.data}
            initialBestSellers={bestSellers}
            onPickCategory={pickHubCategory}
            onPickAll={() => openFromHub({ all: true })}
            onPickBrand={(brand) => openFromHub({ brands: [brand] })}
          />
        ) : (
          <>
            {/* Dính ở khung bọc, không ở chính SortBar: cha của phần tử dính phải cao bằng cả danh sách. Từ lg cột lọc đã có nên nút Lọc ẩn đi (`!hidden` vì nút có `display` ở style). */}
            <div ref={listTopRef} data-testid="browse-list-top" aria-hidden="true" />
            <div ref={sortStickyRef} className="sticky top-[var(--sort-bar-top,0px)] z-[2] -mx-4 md:mx-0 lg:[&>div>button:last-child]:!hidden">
              <SortBar
                value={sortTab(state.sort)}
                options={browseSortOptions(state.sort, Boolean(state.q))}
                onChange={(tab) => {
                  const next = tab as SortTab;
                  // Chạm lại tab đang chọn không làm gì; riêng tab Giá đảo chiều.
                  if (next !== 'price' && next === sortTab(state.sort)) return;
                  leaveSearchField();
                  updateList({ sort: sortForTab(state.sort, next) });
                }}
                filterCount={activeFilterCount(state)}
                onFilter={() => setFiltersOpen(true)}
              />
            </div>
            <ListHeading
              title={listTitle}
              count={products.isError && list.length === 0 ? undefined : (firstPage?.meta.total ?? 0)}
              isLoading={products.isLoading}
            />
            {brandSlug && !state.q && (
              <p className="mb-2 text-sm">
                <Link href={`/brand/${encodeURIComponent(brandSlug)}`} className="inline-flex min-h-11 items-center gap-1 font-semibold text-forest-700 underline">
                  {browseText.viewBrand(singleBrand!)}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </p>
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
            <section aria-labelledby="danh-sach-san-pham" className="pb-6 pt-2">
              <h2 id="danh-sach-san-pham" className="sr-only">
                Danh sách sản phẩm
              </h2>
              {products.isLoading ? (
                <ProductGridSkeleton count={8} className={GRID_PRODUCTS_WITH_FILTER} />
              ) : products.isError && list.length === 0 ? (
                <ErrorState message={errorMessage(products.error)} onRetry={() => void products.refetch()} retryLabel={browseText.retry} />
              ) : list.length === 0 ? (
                <EmptyResults q={state.q} root={root} onClear={() => updateList(CLEAR_SEARCH_PATCH)} />
              ) : (
                <>
                  <div ref={gridRef}>
                    <ProductGrid items={list} variant="grid" className={GRID_PRODUCTS_WITH_FILTER} priorityCount={PRIORITY_CARDS} />
                  </div>
                  {/* Lỗi khi ĐÃ có dữ liệu ("Xem thêm" hoặc làm mới nền thất bại): giữ nguyên danh sách, báo và thử lại tại chỗ. */}
                  {products.isError && (
                    <div role="alert" className="flex flex-wrap items-center justify-center gap-2 pt-4">
                      <p className="text-sm text-danger-fg">{browseText.loadMoreFailed}</p>
                      <button
                        type="button"
                        disabled={products.isFetching}
                        onClick={() => {
                          (products.isFetchNextPageError ? products.fetchNextPage() : products.refetch()).catch(() => undefined);
                        }}
                        className={ui.btnSecondary}
                      >
                        {browseText.retry}
                      </button>
                    </div>
                  )}
                  {products.hasNextPage && !products.isFetchNextPageError && (
                    <div className="flex justify-center pt-4 lg:hidden">
                      <button
                        type="button"
                        aria-disabled={products.isFetchingNextPage || undefined}
                        onClick={loadMore}
                        className={`${ui.btnSecondary} min-w-40 aria-disabled:opacity-60`}
                      >
                        {browseText.loadMore}
                      </button>
                    </div>
                  )}
                  <BrowsePager
                    state={state}
                    startPage={startPage}
                    lastPage={lastPageMeta?.page ?? page}
                    totalPages={totalPages}
                    hasNext={products.hasNextPage}
                  />
                </>
              )}
            </section>
            {/* Tìm/lọc không ra gì vẫn cho khách lối đi tiếp. */}
            {noResults && <RecentlyViewedRail />}
          </>
        )}
      </ListingLayout>

      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} state={state} brands={brandsQ.data ?? []} onApply={applyFilters} />
    </div>
  );
}

function EmptyResults({ q, root, onClear }: { q: string; root: boolean; onClear: () => void }) {
  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-10 text-center shadow-card">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-forest-50 text-forest-600">
        {q ? <Search className="h-6 w-6" aria-hidden="true" /> : <Leaf className="h-6 w-6" aria-hidden="true" />}
      </div>
      <h3 className="mt-3 break-words font-display text-lg font-semibold text-stone-900">
        {q ? browseText.noResultHeading(q) : root ? browseText.emptyHeading : browseText.noResultFiltered}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">{root ? browseText.emptyBody : browseText.noResultBody}</p>
      {!root && (
        <button type="button" onClick={onClear} className={`${ui.btnPrimary} mt-4`}>
          {browseText.clearAll}
        </button>
      )}
    </div>
  );
}
