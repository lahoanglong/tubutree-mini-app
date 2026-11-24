'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bestSellersWithBasis } from '@tubutree/app-core/api/browse';
import { fetchProducts, type CategoryDTO, type PageResponse, type ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { homeCopy } from '@tubutree/app-core/home-copy';
import {
  BRAND_SHOWCASE_EAGER,
  BRAND_SHOWCASE_FETCH,
  brandShowcase,
  brandShowcaseHref,
  brandShowcaseItems,
  brandShowcaseSkeletonCount,
  type BrandShowcaseEntry,
} from '@tubutree/app-core/merch/brand-showcase';
import { brandsQuery } from '@tubutree/app-core/queries/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '@/lib/core-http';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { GRID_BRAND } from '@/lib/product-grid';
import { Button, ProductGrid, SectionHeader } from '@/components/mini';
import { HomeBlockError } from './home-block-error';

export interface SuggestFeedProps {
  /** Khối thương hiệu không dùng ba trường này (không còn lưới gợi ý xếp theo ngày); giữ để Trang chủ gọi khối `suggest` như cũ. */
  initial?: PageResponse<ProductCardData>;
  seed?: string;
  categories?: CategoryDTO[];
  /** Slug món đã nằm ở các kệ hàng phía trên: mỗi nhãn ưu tiên món chưa hiện (`brandShowcaseItems`). */
  exclude: ReadonlySet<string>;
  /** Thẻ chen (Chẩn đoán tổ ấm hoặc Cộng đồng) trải hết bề ngang, đứng sau nhãn cuối. */
  interleave?: ReactNode;
}

const brandProductsKey = (entry: BrandShowcaseEntry) => ['products', 'home-brand', entry.key, BRAND_SHOWCASE_FETCH] as const;

/**
 * Một nhãn của khối: tiêu đề (tên nhãn), câu giới thiệu một dòng, "Tất cả (n)" tới danh sách lọc theo nhãn, rồi 4 món bán chạy 30 ngày (còn hàng trước).
 * `BRAND_SHOWCASE_EAGER` nhãn đầu tải món ngay khi khối dựng, nhãn sau chỉ tải khi gần khung nhìn; mọi nhãn chỉ vẽ ô thật khi gần khung nhìn (Trang chủ ở
 * điện thoại giữ dưới trần nút DOM của khối `suggest` lúc mới mở). Chưa vẽ ô thật thì giữ chỗ đúng số ô sẽ vẽ (ô giữ chỗ một nút `reserve` khi còn xa, khung chờ
 * khi đang tải): chip của thanh nhảy nhanh cuộn qua các nhãn phía trên đích mà chúng không nở ra đẩy đích xuống (Safari không có neo cuộn). Nhãn tải xong
 * mà không còn món, hay lỗi, thì ẩn hẳn.
 */
function BrandSection({ entry, exclude, eager }: { entry: BrandShowcaseEntry; exclude: ReadonlySet<string>; eager: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  // Back về Trang chủ khi món của nhãn còn trong cache: vẽ ngay để hook khôi phục cuộn có đủ chiều cao.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined' || queryClient.getQueryData(brandProductsKey(entry)) !== undefined);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const q = useQuery({
    queryKey: brandProductsKey(entry),
    queryFn: () => bestSellersWithBasis((sort) => fetchProducts(coreHttp, { brand: entry.brand, sort, limit: BRAND_SHOWCASE_FETCH })),
    enabled: eager || near,
    staleTime: 60_000,
    retry: 1,
  });
  const items = useMemo(() => brandShowcaseItems(q.data?.data ?? [], exclude), [q.data, exclude]);
  if (q.isError || (q.isSuccess && items.length === 0)) return null;
  return (
    // Neo không tự đặt scroll-margin: `scroll-padding-top` của html (globals.css) đã chừa thanh đầu dính, cộng thêm thì tiêu đề nhãn dừng thấp gấp đôi.
    <section ref={ref} id={entry.anchorId} aria-label={entry.brand} data-testid="home-brand-section">
      <SectionHeader
        as="h3"
        title={entry.brand}
        subtitle={entry.tagline ?? undefined}
        action={{ to: brandShowcaseHref(entry, 'web'), label: fillCopy('section.seeAllCount', { n: entry.count }) }}
      />
      {q.isSuccess && near ? (
        <ProductGrid items={items} variant="grid" className={GRID_BRAND} shelf="homeBrand" />
      ) : (
        // Khung chờ đầy đủ (~8 nút mỗi ô) chỉ khi nhãn đang tải thật; nhãn còn xa giữ chỗ một nút mỗi ô (Trang chủ 9 nhãn không thêm vài trăm nút DOM).
        <ProductGrid items={[]} variant="grid" loading reserve={!near} skeletonCount={brandShowcaseSkeletonCount(entry)} className={GRID_BRAND} />
      )}
    </section>
  );
}

/**
 * "Khám phá theo Thương hiệu" (khối `suggest` cuối Trang chủ, bản web của `suggest-feed.tsx` ở Mini App): mỗi thương hiệu một mục, theo số sản phẩm giảm dần và
 * "Tubu Tree" cuối (`brandShowcase`), cùng thứ tự với thanh chip dưới Danh mục. Hai nhãn đầu tải ngay, nhãn sau tải lười. Thẻ chen đứng sau nhãn cuối.
 */
export function SuggestFeed({ exclude, interleave }: SuggestFeedProps) {
  const router = useRouter();
  const q = useQuery({ ...brandsQuery(coreHttp), staleTime: 60_000, retry: false });
  const brands = useMemo(() => brandShowcase(q.data), [q.data]);
  const title = fillCopy('home.brands.title');
  if (q.isSuccess && brands.length === 0) return null;
  return (
    <section aria-label={title}>
      <SectionHeader title={title} />
      {q.isLoading ? (
        <ProductGrid items={[]} variant="grid" loading skeletonCount={4} className={GRID_BRAND} />
      ) : q.isError ? (
        <HomeBlockError title={title} error={q.error} onRetry={q.refetch} retrying={q.isFetching} />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-md)' }}>
            {brands.map((entry, i) => (
              <BrandSection key={entry.key} entry={entry} exclude={exclude} eager={i < BRAND_SHOWCASE_EAGER} />
            ))}
            {/* Thẻ chen cao theo dữ liệu về muộn (Cộng đồng từ trống thành 228px): đứng giữa các nhãn thì đẩy lệch chip nhảy nhanh tới nhãn bên dưới.
                Không vẽ gì (Cộng đồng chưa có bài) thì ô bị ẩn hẳn, không để lại khoảng trống. */}
            {interleave ? <div data-testid="suggest-interleave" className="empty:hidden">{interleave}</div> : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-stack-md) 0' }}>
            <Button variant="secondary" onPress={() => router.push(browseHref(EMPTY_SEARCH_STATE))} style={{ minWidth: 160 }}>
              {homeCopy.suggest.enter}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
