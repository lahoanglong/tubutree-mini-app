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

// Mỗi danh mục và mỗi số trang là một URL riêng nhưng cùng bảng xếp hạng: chỉ trang gốc được lập chỉ mục, các biến thể còn lại
// noindex (follow để crawler vẫn đi tới sản phẩm) và canonical về trang gốc.
export async function generateMetadata({ searchParams }: { searchParams: BestSellersSearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const filtered = Boolean(firstParam(sp.category)) || parsePage(sp.page) > 1;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: '/ban-chay' },
    openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Phần phụ của trang (cây danh mục, danh sách đầu): lỗi thì bỏ phần đó, để BestSellersView tự tải lại phía trình duyệt. */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

export default async function BestSellersPage({ searchParams }: { searchParams: BestSellersSearchParams }) {
  const sp = await searchParams;
  const startPage = parsePage(sp.page);
  const http = createServerHttp();
  // Cây trước để biết `category` có phải danh mục gốc thật không: id lạ thì không lọc (danh sách rỗng là sai).
  const categories = await orUndefined(fetchCategories(http));
  const scope = bestSellerScope(categories ? bestSellerTabs(categories) : null, firstParam(sp.category));
  const first = await orUndefined(fetchBestSellersPage(http, { category: scope.category, page: startPage }));

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
