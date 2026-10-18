'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronRight, Leaf, Search, X } from 'lucide-react';
import type { CatalogPage, CategoryDTO, ProductCard as ProductCardData, ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { brandsQuery, browseQuery, categoriesQuery } from '@tubutree/app-core/queries/catalog';
import { browseText } from '@/lib/browse-text';
import { categoryEntries, segmentLabel, type CategoryEntry } from '@/lib/browse-categories';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from '@/lib/recent-searches';
import {
  CLEAR_SEARCH_PATCH, activeFilterChips, activeFilterCount, isBrowseRoot, toCatalogQuery, type FilterDraft,
} from '@/lib/search-state';
import { useBrowseState } from '@/lib/use-browse-state';
import { useSuggest } from '@/lib/use-suggest';
import ProductCard, { PRIORITY_CARDS } from '@/components/product-card';
import { ErrorState } from '@/components/ui/error-state';
import { ProductGridSkeleton } from '@/components/ui/skeleton';
import { BrowsePager } from './browse-pager';
import { CategoryGrid } from './category-grid';
import { FilterSheet } from './filter-sheet';
import { RecentlyViewedRail } from './recently-viewed-rail';
import { ResultHeader } from './result-header';
import { SortChips } from './sort-chips';
import { SuggestList } from './suggest-list';

export const PAGE_LIMIT = 24;

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
}

const uniqueById = (list: ProductCardData[]) => {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
};

const errorMessage = (e: unknown) => (e instanceof Error && e.message ? e.message : undefined);

/**
 * Trang Danh mục / Tìm kiếm của web, cùng hành vi với pages/browse.tsx của Mini App. Toàn bộ trạng thái (q, sắp xếp, lọc,
 * danh mục, phân khúc, thương hiệu) nằm trong URL (`useBrowseState`, replace). Gõ chỉ hiện GỢI Ý; Enter hoặc chạm gợi ý mới
 * ghi `q`.
 */
export default function BrowseView({ initial = null, brands: initialBrands, categories: initialCategories }: BrowseViewProps) {
  const router = useRouter();
  const { state, urlKey, focusSearch, page, update, consumeFocus } = useBrowseState();
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
  const listKey = seeded && seeded.startPage > 1 ? `${urlKey}#p${seeded.startPage}` : urlKey;
  const products = useInfiniteQuery({
    ...browseQuery(coreHttp, listKey, (page) => toCatalogQuery(state, page, PAGE_LIMIT)),
    initialPageParam: seeded?.startPage ?? 1,
    getNextPageParam: (last: CatalogPage) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
    ...(seeded ? { initialData: { pages: [seeded.page], pageParams: [seeded.startPage] }, staleTime: 60_000 } : {}),
  });
  const firstPage = products.data?.pages[0];
  const list = uniqueById(products.data?.pages.flatMap((pg) => pg.data) ?? []);

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
    update({ q: t });
  };
  const pickCategory = (e: CategoryEntry) => {
    stopEditing();
    update(e.kind === 'category' ? { category: e.key, segment: undefined, q: '' } : { segment: e.key, category: undefined, q: '' });
  };
  const pickSuggestion = (p: ProductSuggestion) => {
    stopEditing();
    router.push(`/san-pham/${encodeURIComponent(p.slug)}`);
  };
  const applyFilters = (d: FilterDraft) => {
    setFiltersOpen(false);
    update({ brands: d.brands, minPrice: d.minPrice, maxPrice: d.maxPrice, inStock: d.inStock, minRating: d.minRating });
  };

  const root = isBrowseRoot(state);
  const categoryName = state.category ? categoriesQ.data?.find((c) => c.id === state.category)?.name : undefined;
  const chips = activeFilterChips(state, { categoryName, segmentName: state.segment ? segmentLabel(state.segment) : undefined });
  const noResults = !products.isLoading && !products.isError && list.length === 0;
  // Trang nhãn hàng (/brand/:slug) chỉ có khi nhãn đã công khai; đây là liên kết duy nhất dẫn tới nó từ danh mục.
  const brandSlug = state.brands.length === 1 ? (brandsQ.data?.find((b) => b.brand === state.brands[0])?.slug ?? null) : null;

  return (
    <div>
      <h1 className={`${ui.pageTitle} mb-3`}>{browseText.title}</h1>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          commit(draft);
        }}
        className="flex items-center gap-2 pb-2"
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
            className={`${ui.field} pl-9 pr-11`}
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
        {editing && (
          <button type="button" onClick={leaveSearchField} className={ui.btnText}>
            {browseText.cancel}
          </button>
        )}
      </form>

      {showSuggest ? (
        <SuggestList
          draft={draft}
          recent={recent}
          categories={entries}
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
          {root && <CategoryGrid entries={entries} isLoading={categoriesQ.isLoading} onSelect={pickCategory} />}
          {root && <RecentlyViewedRail />}
          <SortChips
            value={state.sort}
            onChange={(sort) => {
              leaveSearchField();
              update({ sort });
            }}
          />
          <ResultHeader
            total={firstPage?.meta.total ?? 0}
            isLoading={products.isLoading}
            chips={chips}
            filterCount={activeFilterCount(state)}
            filtersIgnored={firstPage?.filtersIgnored ?? false}
            onOpenFilters={() => setFiltersOpen(true)}
            onPatch={(patch) => {
              leaveSearchField();
              update(patch);
            }}
          />
          {brandSlug && (
            <p className="mb-2 text-sm">
              <Link href={`/brand/${encodeURIComponent(brandSlug)}`} className="inline-flex min-h-11 items-center gap-1 font-semibold text-forest-700 underline">
                Xem trang nhãn hàng {state.brands[0]}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </p>
          )}
          <section aria-labelledby="danh-sach-san-pham" className="pb-6">
            <h2 id="danh-sach-san-pham" className="sr-only">
              Danh sách sản phẩm
            </h2>
            {products.isLoading ? (
              <ProductGridSkeleton count={8} />
            ) : products.isError && list.length === 0 ? (
              <ErrorState message={errorMessage(products.error)} onRetry={() => void products.refetch()} retryLabel={browseText.retry} />
            ) : list.length === 0 ? (
              <EmptyResults
                q={state.q}
                root={root}
                onClear={() => update(CLEAR_SEARCH_PATCH)}
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 md:grid-cols-4">
                  {list.map((p, i) => (
                    <ProductCard key={p.id} product={p} priority={i < PRIORITY_CARDS} />
                  ))}
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
                  <div className="flex justify-center pt-4">
                    <button
                      type="button"
                      disabled={products.isFetchingNextPage}
                      onClick={() => {
                        products.fetchNextPage().catch(() => undefined);
                      }}
                      className={`${ui.btnSecondary} min-w-40`}
                    >
                      {browseText.loadMore}
                    </button>
                  </div>
                )}
                <BrowsePager
                  state={state}
                  startPage={seeded?.startPage ?? page}
                  lastPage={products.data?.pages.at(-1)?.meta.page ?? page}
                  hasNext={products.hasNextPage}
                />
              </>
            )}
          </section>
          {/* Tìm/lọc không ra gì vẫn cho khách lối đi tiếp; ở trang gốc dải đã hiện phía trên lưới. */}
          {noResults && !root && <RecentlyViewedRail />}
        </>
      )}

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
