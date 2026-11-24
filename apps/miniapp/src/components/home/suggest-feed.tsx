import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { bestSellersWithBasis } from '@tubutree/app-core/api/browse';
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
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { fetchBrands, fetchProducts } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { ProductGrid } from '../ui/product-grid';
import { SectionHeader } from '../ui/section-header';
import { HomeBlockError } from './home-block-error';

/** Ô thẻ chen không là một mục của cột: thẻ chen không vẽ gì (Cộng đồng chưa có bài) thì không để lại một khoảng cách thừa cuối khối. */
const INTERLEAVE_STYLE = { display: 'contents' } as const;
export interface SuggestFeedProps {
  /** Slug món đã nằm ở các kệ hàng phía trên: mỗi nhãn ưu tiên món chưa hiện (`brandShowcaseItems`). */
  exclude: ReadonlySet<string>;
  /** Thẻ chen (Chẩn đoán tổ ấm hay Cộng đồng, trang chọn theo ngày) trải hết bề ngang, đứng sau nhãn cuối. */
  interleave?: ReactNode;
}

const brandProductsKey = (entry: BrandShowcaseEntry) => ['products', 'home-brand', entry.key, BRAND_SHOWCASE_FETCH] as const;

/**
 * Cờ "phần tử đã cách màn hình chưa tới một màn", một chiều (đã gần thì giữ). Trang Mini cuộn trong `.zaui-page`: lấy chính khung cuộn làm gốc để "một màn"
 * đúng nghĩa (gốc khung nhìn không với tới phần bị khung cắt). Môi trường không có IntersectionObserver thì coi như đã gần.
 */
function useNearPage<T extends HTMLElement>(initial: boolean) {
  const [el, ref] = useState<T | null>(null);
  const [near, setNear] = useState(() => initial || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (near || !el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { root: el.closest('.zaui-page'), rootMargin: '100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near, el]);
  return [ref, near] as const;
}

/**
 * Một nhãn của khối: tiêu đề (tên nhãn), câu giới thiệu một dòng, "Tất cả (n)" tới danh sách lọc theo nhãn, rồi 4 món bán chạy 30 ngày (còn hàng trước).
 * Nhãn trong `BRAND_SHOWCASE_EAGER` nhãn đầu tải ngay khi khối tới gần màn; nhãn sau chờ chính nó tới gần. Chưa có món thì giữ chỗ đúng số ô sẽ vẽ
 * (ô giữ chỗ một nút `reserve` khi còn xa, khung chờ khi đang tải): chip của thanh nhảy nhanh cuộn qua các nhãn phía trên đích mà chúng không nở ra đẩy đích xuống
 * (WebView iOS không có neo cuộn). Back từ PDP mà dữ liệu còn
 * trong cache thì vẽ ngay để hook khôi phục cuộn có đủ chiều cao. Nhãn tải xong mà không còn món, hay lỗi, thì ẩn hẳn.
 */
function BrandSection({ entry, exclude, eager, blockNear }: { entry: BrandShowcaseEntry; exclude: ReadonlySet<string>; eager: boolean; blockNear: boolean }) {
  const queryClient = useQueryClient();
  const [ref, near] = useNearPage<HTMLElement>(eager || queryClient.getQueryData(brandProductsKey(entry)) !== undefined);
  const q = useQuery({
    queryKey: brandProductsKey(entry),
    queryFn: () => bestSellersWithBasis((sort) => fetchProducts({ brand: entry.brand, sort, limit: BRAND_SHOWCASE_FETCH })),
    enabled: blockNear && near,
    staleTime: 60_000,
    retry: 1,
  });
  const items = useMemo(() => brandShowcaseItems(q.data?.data ?? [], exclude), [q.data, exclude]);
  if (q.isError || (q.isSuccess && items.length === 0)) return null;
  return (
    // Neo không tự đặt scroll-margin: `scroll-padding-top` của `.zaui-page` (tokens.css) đã chừa header dính, cộng thêm thì tiêu đề nhãn dừng thấp gấp đôi.
    <section ref={ref} id={entry.anchorId} aria-label={entry.brand} data-testid="home-brand-section">
      <SectionHeader
        as="h3"
        title={entry.brand}
        subtitle={entry.tagline ?? undefined}
        action={{ to: brandShowcaseHref(entry, 'mini'), label: fillCopy('section.seeAllCount', { n: entry.count }) }}
      />
      {q.isSuccess ? (
        <ProductGrid items={items} variant="grid" listSource="home_brand" />
      ) : (
        // Khung chờ đầy đủ (~8 nút mỗi ô) chỉ khi nhãn đang tải thật; nhãn còn xa giữ chỗ một nút mỗi ô (Trang chủ 9 nhãn không thêm vài trăm nút DOM).
        <ProductGrid items={[]} variant="grid" loading reserve={!(blockNear && near)} skeletonCount={brandShowcaseSkeletonCount(entry)} />
      )}
    </section>
  );
}

/**
 * "Khám phá theo Thương hiệu" (khối `suggest` cuối Trang chủ): mỗi thương hiệu một mục, theo số sản phẩm giảm dần và "Tubu Tree" cuối (`brandShowcase`), cùng
 * thứ tự với thanh chip dưới Danh mục. Thương hiệu đến từ khối gộp `/home` (cùng khoá với thanh chip). Hai nhãn đầu tải ngay, nhãn sau tải lười; thẻ chen
 * đứng sau nhãn cuối. Cuối khối là lối vào Danh mục.
 */
export function SuggestFeed({ exclude, interleave }: SuggestFeedProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Cả khối nằm cuối trang: mở Trang chủ không bắn request của các nhãn (luật gộp request C-037), chỉ khi khối tới gần màn. Dữ liệu nhãn còn trong cache (Back) thì vẽ ngay.
  const [ref, blockNear] = useNearPage<HTMLElement>(queryClient.getQueriesData({ queryKey: ['products', 'home-brand'] }).some(([, d]) => d !== undefined));
  const q = useQuery({ queryKey: ['brands'], queryFn: fetchBrands, staleTime: 60_000, retry: false });
  const brands = useMemo(() => brandShowcase(q.data), [q.data]);
  const title = fillCopy('home.brands.title');
  if (q.isSuccess && brands.length === 0) return null;
  return (
    <section ref={ref} aria-label={title} style={{ padding: '0 var(--space-inset-page)' }}>
      <SectionHeader title={title} />
      {q.isLoading ? (
        <ProductGrid items={[]} variant="grid" loading skeletonCount={4} />
      ) : q.isError ? (
        <HomeBlockError title={title} error={q.error} onRetry={q.refetch} retrying={q.isFetching} />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-md)' }}>
            {brands.map((entry, i) => (
              <BrandSection key={entry.key} entry={entry} exclude={exclude} eager={i < BRAND_SHOWCASE_EAGER} blockNear={blockNear} />
            ))}
            {/* Thẻ chen cao theo dữ liệu về muộn (Cộng đồng): đứng giữa các nhãn thì đẩy lệch chip nhảy nhanh tới nhãn bên dưới. Dựng khi khối tới gần
                màn như món của các nhãn: Cộng đồng tự gọi /feed, mở Trang chủ không thêm request (C-037). */}
            {interleave && blockNear ? <div data-testid="suggest-interleave" style={INTERLEAVE_STYLE}>{interleave}</div> : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-stack-md) 0' }}>
            <Button
              variant="secondary"
              onPress={() => {
                haptic('light');
                navigate('/browse');
              }}
              style={{ minWidth: 160 }}
            >
              {homeCopy.suggest.enter}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
