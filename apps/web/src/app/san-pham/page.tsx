import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fetchBrands, fetchCatalog, fetchCategories } from '@tubutree/app-core/api/catalog';
import BrowseView, { PAGE_LIMIT, type BrowseInitial } from '@/components/catalog/browse-view';
import { firstParam, normalizeSearchQuery, parsePage } from '@/lib/catalog-filter';
import { createServerHttp } from '@/lib/core-http-server';
import { browseMetadata, browseNoindex } from '@/lib/home-seo';
import { BROWSE_PATH, parseSearchState, serializeSearchState, toCatalogQuery } from '@/lib/search-state';

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
// (cùng sản phẩm với danh mục gốc, chỉ khác lối vào). Nhãn và số trang thì mỗi biến thể có tiêu đề + canonical riêng
// (xem home-seo) để không bị coi là bản trùng của trang gốc.
export async function generateMetadata({ searchParams }: { searchParams: BrowseSearchParams }): Promise<Metadata> {
  const params = toParams(await searchParams);
  if (browseNoindex(params)) return { robots: { index: false, follow: true } };
  const brand = firstParam(params.get('brand') ?? undefined);
  const brandKnown = brand ? (await fetchBrands(createServerHttp())).some((b) => b.brand === brand) : true;
  return browseMetadata({ brand, page: parsePage(params.get('page')) }, brandKnown);
}

/** Phần phụ của trang (nhãn, danh mục, danh sách đầu): lỗi thì bỏ phần đó, để BrowseView tự tải lại phía trình duyệt. */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

export default async function BrowsePage({ searchParams }: { searchParams: BrowseSearchParams }) {
  const params = toParams(await searchParams);
  const state = parseSearchState(params);
  const startPage = parsePage(params.get('page'));
  const http = createServerHttp();
  const [catalog, brands, categories] = await Promise.all([
    orUndefined(fetchCatalog(http, toCatalogQuery(state, startPage, PAGE_LIMIT))),
    orUndefined(fetchBrands(http)),
    orUndefined(fetchCategories(http)),
  ]);

  // ?page= vượt trang cuối (sản phẩm vừa bị gỡ, hoặc URL cũ): đưa về trang cuối thay vì hiện "chưa có sản phẩm".
  if (catalog && catalog.data.length === 0 && catalog.meta.total > 0 && startPage > 1) {
    const lastPage = Math.max(1, Math.ceil(catalog.meta.total / (catalog.meta.limit || PAGE_LIMIT)));
    const qs = serializeSearchState(state);
    if (lastPage > 1) qs.set('page', String(lastPage));
    redirect(`${BROWSE_PATH}${qs.size > 0 ? `?${qs.toString()}` : ''}`);
  }

  const initial: BrowseInitial | null = catalog
    ? { urlKey: serializeSearchState(state).toString(), page: catalog, startPage }
    : null;
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 max-md:pb-0 max-md:pt-3 md:py-8">
      <BrowseView initial={initial} brands={brands} categories={categories} />
    </main>
  );
}
