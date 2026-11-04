import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fetchBrands, fetchCatalog, fetchCategories } from '@tubutree/app-core/api/catalog';
import { fetchBestSellers } from '@tubutree/app-core/api/browse';
import { categoryTrail } from '@tubutree/app-core/browse/category-tree';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { shelf } from '@tubutree/app-core/merch/shelves';
import BrowseView, { type BrowseInitial } from '@/components/catalog/browse-view';
import { firstParam, normalizeSearchQuery, parsePage } from '@/lib/catalog-filter';
import { createServerHttp } from '@/lib/core-http-server';
import { BROWSE_INDEX_MAX_PAGE, browseBreadcrumb, browseMetadata, browseNoindex } from '@/lib/home-seo';
import { browseText } from '@/lib/browse-text';
import { jsonLdScript, breadcrumbJsonLd } from '@/lib/product-seo';
import { BROWSE_PATH, PAGE_LIMIT, appendForeignParams, isBrowseHub, parseSearchState, serializeSearchState, toCatalogQuery, type SearchState } from '@/lib/search-state';
import { PAGE_WIDE } from '@/lib/page-frame';

export const revalidate = 300;

type BrowseSearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Next đưa tham số lặp vào searchParams dưới dạng mảng; lấy giá trị đầu của mỗi khoá, như useSearchParams().get. */
function toParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const v = firstParam(value);
    if (v !== undefined) params.set(key, v);
  }
  return params;
}

// Mỗi từ khoá và mỗi cách lọc/sắp xếp là một URL riêng: không để công cụ tìm kiếm lập chỉ mục vô số trang kết quả
// (cùng sản phẩm với danh mục gốc, chỉ khác lối vào). Nhãn, danh mục (đứng một mình, có thật) và số trang thì mỗi biến thể có tiêu đề + canonical
// riêng (xem home-seo) để không bị coi là bản trùng của trang gốc.
export async function generateMetadata({ searchParams }: { searchParams: BrowseSearchParams }): Promise<Metadata> {
  const params = toParams(await searchParams);
  if (browseNoindex(params)) return { robots: { index: false, follow: true } };
  const categoryId = params.get('category') ?? undefined;
  if (categoryId) {
    // Danh mục không có trong cây (id bịa) → noindex, như nhãn lạ. Lỗi API thì để nổi lên (như nhánh nhãn): nuốt lỗi sẽ trả 200 + noindex
    // cho danh mục thật và làm URL rớt khỏi chỉ mục.
    const trail = categoryTrail(await fetchCategories(createServerHttp()), categoryId);
    const node = trail.at(-1);
    if (!node) return { robots: { index: false, follow: true } };
    return browseMetadata({ category: { id: categoryId, name: node.name } }, true);
  }
  const brand = firstParam(params.get('brand') ?? undefined);
  const brandKnown = brand ? (await fetchBrands(createServerHttp())).some((b) => b.brand === brand) : true;
  return browseMetadata({ brand, page: parsePage(params.get('page')) }, brandKnown);
}

/** Phần phụ của trang (nhãn, danh mục, danh sách đầu): lỗi thì bỏ phần đó, để BrowseView tự tải lại phía trình duyệt. */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/** Trang xa nhất còn dựng sẵn ở máy chủ (cũng là trần lập chỉ mục); sâu hơn thì trình duyệt tự tải. */
const SSR_MAX_PAGE = BROWSE_INDEX_MAX_PAGE;

/**
 * Mỗi trạng thái danh sách dựng ở máy chủ là một lượt gọi API mang token vượt throttle và một file Data Cache không bao giờ xoá, nên chỉ
 * dựng sẵn hai nhóm hữu hạn. Một: trang được lập chỉ mục (xem browseNoindex/browseMetadata): đúng một nhãn có thật theo trang, một danh mục
 * có thật đứng một mình ở trang 1. Hai: lối "Xem tất cả" — ?all=1 và phân trang gốc ?page=N (noindex, nhưng chung một khoá API với
 * ?all=1&page=N nên mỗi trang chỉ một file). Mọi tổ hợp khác (nhiều nhãn, sắp xếp, giá, phân khúc, từ khoá…) nhân lên hàng triệu khoá:
 * BrowseView tải ở trình duyệt. So trên dạng chuẩn của trạng thái nên tham số rác hay tham số lạ (utm) không đẻ thêm khoá.
 */
/** Lối "Xem tất cả" (gốc theo trang hoặc ?all=1): không cần nhãn/danh mục để quyết định nên tải danh sách song song. */
function isPlainListState(state: SearchState): boolean {
  const keys = [...serializeSearchState(state).keys()];
  return keys.length === 0 || (keys.length === 1 && keys[0] === 'all');
}

function isServerListState(state: SearchState, page: number, brands: { brand: string }[] | undefined, categories: Parameters<typeof categoryTrail>[0] | undefined): boolean {
  if (isPlainListState(state)) return true;
  const keys = [...serializeSearchState(state).keys()];
  if (keys.length > 1) return false;
  switch (keys[0]) {
    case 'brand':
      return state.brands.length === 1 && !!brands?.some((b) => b.brand === state.brands[0]);
    case 'category':
      return page === 1 && categoryTrail(categories, state.category!).length > 0;
    default:
      return false;
  }
}

/** URL vượt trang cuối (sản phẩm vừa bị gỡ, link cũ): về trang cuối thay vì hiện "chưa có sản phẩm", giữ tham số lạ (utm, ref) của link. */
function redirectToLastPage(state: SearchState, total: number, params: URLSearchParams): never {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const qs = serializeSearchState(state);
  if (lastPage > 1) qs.set('page', String(lastPage));
  appendForeignParams(qs, params);
  redirect(`${BROWSE_PATH}${qs.size > 0 ? `?${qs.toString()}` : ''}`);
}

/** BreadcrumbList cho trang nhãn / danh mục đứng một mình (cùng vệt với breadcrumb hiển thị của BrowseView); trạng thái khác không có. */
function breadcrumbOf(params: URLSearchParams, stateBrands: string[], brands: { brand: string }[] | undefined, categories: Parameters<typeof categoryTrail>[0]) {
  if (browseNoindex(params)) return null;
  const home = fillCopy('browse.crumbHome');
  const categoryId = params.get('category');
  if (categoryId) {
    const trail = categoryTrail(categories, categoryId);
    return trail.length > 0 ? browseBreadcrumb({ home, browse: browseText.title, category: trail }) : null;
  }
  const brand = stateBrands.length === 1 ? stateBrands[0] : undefined;
  return brand && brands?.some((b) => b.brand === brand) ? browseBreadcrumb({ home, browse: browseText.title, brand }) : null;
}

export default async function BrowsePage({ searchParams }: { searchParams: BrowseSearchParams }) {
  const params = toParams(await searchParams);
  const state = parseSearchState(params);
  const startPage = parsePage(params.get('page'));
  const http = createServerHttp();
  // Gốc không tham số, trang 1 là hub: KHÔNG tải danh sách, chỉ kệ Bán chạy nhất (HTML đầu có sản phẩm cho crawler).
  const hub = isBrowseHub(state, startPage);
  // Trang sâu hơn trần không dựng sẵn, nhưng link cũ vượt trang cuối vẫn phải về trang cuối: hỏi tổng bằng trang 1, 1 món (khoá không chứa
  // số trang nên số file Data Cache vẫn hữu hạn).
  const loadList = () =>
    orUndefined(fetchCatalog(http, startPage <= SSR_MAX_PAGE ? toCatalogQuery(state, startPage, PAGE_LIMIT) : toCatalogQuery(state, 1, 1)));
  const plainList = !hub && isPlainListState(state);
  const [bestSellers, brands, categories, early] = await Promise.all([
    hub ? orUndefined(fetchBestSellers(http, shelf('browse.bestSellers').maxItems)) : undefined,
    orUndefined(fetchBrands(http)),
    orUndefined(fetchCategories(http)),
    plainList ? loadList() : undefined,
  ]);
  const listed = plainList ? early : !hub && isServerListState(state, startPage, brands, categories) ? await loadList() : undefined;
  const catalog = startPage <= SSR_MAX_PAGE ? listed : undefined;
  const probe = startPage > SSR_MAX_PAGE ? listed : undefined;

  if (catalog && catalog.data.length === 0 && catalog.meta.total > 0 && startPage > 1) redirectToLastPage(state, catalog.meta.total, params);
  if (probe && probe.meta.total > 0 && startPage > Math.ceil(probe.meta.total / PAGE_LIMIT)) redirectToLastPage(state, probe.meta.total, params);

  const initial: BrowseInitial | null = catalog
    ? { urlKey: serializeSearchState(state).toString(), page: catalog, startPage }
    : null;
  const crumbs = breadcrumbOf(params, state.brands, brands, categories);
  return (
    <main className={`${PAGE_WIDE} md:py-8`}>
      <BrowseView initial={initial} bestSellers={bestSellers} brands={brands} categories={categories} />
      {crumbs && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }} />}
    </main>
  );
}
