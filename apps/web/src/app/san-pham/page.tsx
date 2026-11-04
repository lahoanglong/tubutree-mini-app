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
import { browseBreadcrumb, browseMetadata, browseNoindex } from '@/lib/home-seo';
import { browseText } from '@/lib/browse-text';
import { jsonLdScript, breadcrumbJsonLd } from '@/lib/product-seo';
import { BROWSE_PATH, PAGE_LIMIT, isBrowseHub, parseSearchState, serializeSearchState, toCatalogQuery, type SearchState } from '@/lib/search-state';
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

/** Trang xa nhất còn dựng sẵn ở máy chủ; sâu hơn thì trình duyệt tự tải. */
const SSR_MAX_PAGE = 50;

/**
 * Mỗi trạng thái danh sách dựng ở máy chủ là một lượt gọi API mang token vượt throttle và một file Data Cache không bao giờ xoá, nên chỉ
 * dựng sẵn đúng các trang được lập chỉ mục (xem browseNoindex/browseMetadata): danh sách gốc theo trang, đúng một nhãn có thật theo trang,
 * một danh mục có thật đứng một mình ở trang 1. Thêm ?all=1 đứng một mình: chỉ một URL mỗi trang, là lối "Xem tất cả" từ hub.
 * Mọi tổ hợp khác (nhiều nhãn, sắp xếp, giá, phân khúc, từ khoá…) nhân lên hàng triệu khoá: BrowseView tải ở trình duyệt.
 * So trên dạng chuẩn của trạng thái nên tham số rác hay tham số lạ (utm) không đẻ thêm khoá.
 */
function isServerListState(state: SearchState, page: number, brands: { brand: string }[] | undefined, categories: Parameters<typeof categoryTrail>[0] | undefined): boolean {
  const keys = [...serializeSearchState(state).keys()];
  if (keys.length === 0) return true;
  if (keys.length > 1) return false;
  switch (keys[0]) {
    case 'all':
      return true;
    case 'brand':
      return state.brands.length === 1 && !!brands?.some((b) => b.brand === state.brands[0]);
    case 'category':
      return page === 1 && categoryTrail(categories, state.category!).length > 0;
    default:
      return false;
  }
}

/** URL vượt trang cuối (sản phẩm vừa bị gỡ, link cũ): về trang cuối thay vì hiện "chưa có sản phẩm". */
function redirectToLastPage(state: SearchState, total: number): never {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const qs = serializeSearchState(state);
  if (lastPage > 1) qs.set('page', String(lastPage));
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
  const [bestSellers, brands, categories] = await Promise.all([
    hub ? orUndefined(fetchBestSellers(http, shelf('browse.bestSellers').maxItems)) : undefined,
    orUndefined(fetchBrands(http)),
    orUndefined(fetchCategories(http)),
  ]);
  const serverList = !hub && isServerListState(state, startPage, brands, categories);
  const catalog =
    serverList && startPage <= SSR_MAX_PAGE ? await orUndefined(fetchCatalog(http, toCatalogQuery(state, startPage, PAGE_LIMIT))) : undefined;

  if (catalog && catalog.data.length === 0 && catalog.meta.total > 0 && startPage > 1) redirectToLastPage(state, catalog.meta.total);
  if (serverList && startPage > SSR_MAX_PAGE) {
    // Trang sâu không dựng sẵn, nhưng vẫn phải đưa link cũ vượt trang cuối về trang cuối. Hỏi tổng bằng trang 1, 1 món: khoá không chứa
    // số trang nên số file Data Cache vẫn hữu hạn.
    const probe = await orUndefined(fetchCatalog(http, toCatalogQuery(state, 1, 1)));
    if (probe && probe.meta.total > 0 && startPage > Math.ceil(probe.meta.total / PAGE_LIMIT)) redirectToLastPage(state, probe.meta.total);
  }

  const initial: BrowseInitial | null = catalog
    ? { urlKey: serializeSearchState(state).toString(), page: catalog, startPage }
    : null;
  const crumbs = breadcrumbOf(params, state.brands, brands, categories);
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:pb-0 max-md:pt-0 md:py-8`}>
      <BrowseView initial={initial} bestSellers={bestSellers} brands={brands} categories={categories} />
      {crumbs && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }} />}
    </main>
  );
}
