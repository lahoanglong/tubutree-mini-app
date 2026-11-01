import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fetchBestSellersPage } from '@tubutree/app-core/api/browse';
import { fetchCategories } from '@tubutree/app-core/api/catalog';
import { BEST_SELLERS_PAGE_LIMIT, bestSellerScope, bestSellerTabs, bestSellersHref } from '@tubutree/app-core/browse/best-sellers';
import { firstParam, parsePage } from '@/lib/catalog-filter';
import { createServerHttp } from '@/lib/core-http-server';
import { PAGE_WIDE } from '@/lib/page-frame';
import BestSellersView, { type BestSellersInitial } from './best-sellers-view';

export const revalidate = 300;

type BestSellersSearchParams = Promise<Record<string, string | string[] | undefined>>;

const TITLE = 'Bán chạy nhất — Tubu Tree';
const DESCRIPTION = 'Sản phẩm bán chạy nhất Tubu Tree theo lượt bán 30 ngày qua, xem theo từng danh mục.';

// Theo quy tắc của /san-pham: trang lọc theo danh mục là bản trùng của bảng xếp hạng gốc nên noindex (follow để crawler vẫn đi tới sản phẩm) và
// KHÔNG có canonical, vì noindex kèm canonical sang URL khác là hai tín hiệu mâu thuẫn. Còn lại (kể cả ?page=N) được lập chỉ mục và canonical
// tự trỏ về chính nó, nhưng ?page=1 hay số lạ chuẩn hoá về /ban-chay.
export async function generateMetadata({ searchParams }: { searchParams: BestSellersSearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const base: Metadata = {
    title: page > 1 ? `Bán chạy nhất — Trang ${page} | Tubu Tree` : TITLE,
    description: DESCRIPTION,
    openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
  };
  if (firstParam(sp.category)) return { ...base, robots: { index: false, follow: true } };
  return { ...base, alternates: { canonical: page > 1 ? `/ban-chay?page=${page}` : '/ban-chay' } };
}

/** Phần phụ của trang (cây danh mục, danh sách đầu): lỗi thì bỏ phần đó, để BestSellersView tự tải lại phía trình duyệt. */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

export default async function BestSellersPage({ searchParams }: { searchParams: BestSellersSearchParams }) {
  const sp = await searchParams;
  const startPage = parsePage(sp.page);
  const http = createServerHttp();
  // Gọi song song với `category` thô từ URL; chỉ khi cây về và id đó không phải danh mục gốc thật thì gọi lại không lọc (id lạ: danh sách rỗng là sai).
  const rawCategory = firstParam(sp.category) || undefined;
  const [categories, firstRaw] = await Promise.all([
    orUndefined(fetchCategories(http)),
    orUndefined(fetchBestSellersPage(http, { category: rawCategory, page: startPage })),
  ]);
  const scope = bestSellerScope(categories ? bestSellerTabs(categories) : null, rawCategory);
  const first = scope.category === rawCategory ? firstRaw : await orUndefined(fetchBestSellersPage(http, { category: scope.category, page: startPage }));

  // ?page= vượt trang cuối (món vừa bị gỡ, hoặc URL cũ): đưa về trang cuối thay vì hiện "chưa đủ lượt bán".
  if (first && first.data.length === 0 && first.meta.total > 0 && startPage > 1) {
    const lastPage = Math.max(1, Math.ceil(first.meta.total / (first.meta.limit || BEST_SELLERS_PAGE_LIMIT)));
    redirect(bestSellersHref('web', { category: scope.category, page: lastPage }));
  }

  const initial: BestSellersInitial | null = first ? { category: scope.category, startPage, page: first } : null;
  return (
    <main className={`${PAGE_WIDE} py-6`}>
      <BestSellersView initial={initial} categories={categories} />
    </main>
  );
}
