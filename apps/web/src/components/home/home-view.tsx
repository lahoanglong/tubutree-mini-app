'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Search } from 'lucide-react';
import type { CategoryDTO, PageResponse, ProductCard } from '@tubutree/app-core/api/catalog';
import { notificationsQuery } from '@tubutree/app-core/queries/account';
import { categoriesQuery, forYouQuery } from '@tubutree/app-core/queries/catalog';
import { homeBestSellerQuery, homeFeaturedQuery, homeNewestQuery } from '@tubutree/app-core/queries/home';
import { categoryEntries } from '@/lib/browse-categories';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { homeText, reorderText } from '@/lib/home-text';
import { isWebRouteReady } from '@/lib/route-map';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { usePublicConfig } from '@/lib/use-public-config';
import { CategoryGrid } from '@/components/catalog/category-grid';
import { RecentlyViewedRail } from '@/components/catalog/recently-viewed-rail';
import { PURCHASED_RAIL_LIMIT, PurchasedRail } from '@/components/reorder/purchased-rail';
import { usePurchasedItems } from '@/components/reorder/use-purchased-items';
import { FlashSale, UpcomingFlashSales } from './flash-sale';
import { dedupeAgainst, homeBlockOrder, isEndpointMissing, refreshHomeQueries, type HomeBlockId } from './home-blocks';
import { HomeBlockError, HomeBlockErrorSuppressed } from './home-block-error';
import { HomeExtras } from './home-extras';
import { HomePageError } from './home-page-error';
import { HomeSection, type SectionQuery } from './home-section';
import { NewCustomerGift } from './new-customer-gift';
import { OrderStrip } from './order-strip';
import { PointsBoostStrip } from './points-boost-strip';
import { useBlockQuery } from './use-block-query';
import { useHomeCustomerKind } from './use-home-customer-kind';

const SECTION_LIMIT = 6;
// "Tubu chọn cho bạn" bỏ SP trùng "Dành cho bạn" rồi mới cắt về SECTION_LIMIT → xin dư để vẫn đủ ô sau khi bỏ trùng.
const FEATURED_LIMIT = SECTION_LIMIT * 2;

/** Phần công khai server đã tải cho trang ISR: có trong HTML đầu, React Query tiếp quản sau hydrate. */
export interface HomeInitial {
  bestSellers?: PageResponse<ProductCard>;
  featured?: PageResponse<ProductCard>;
  newest?: PageResponse<ProductCard>;
  categories?: CategoryDTO[];
  brands?: { brand: string; count: number; slug?: string | null }[];
}

const STALE = 60_000;
const withInitial = <T,>(data: T | undefined) => (data !== undefined ? { initialData: data, staleTime: STALE } : {});

/**
 * Trang chủ web, cùng thứ tự khối và hành vi với pages/home.tsx của Mini App. Thứ tự khối theo khách cũ/mới (`homeBlockOrder`):
 * khách cũ thấy "Mua lại" ngay dưới ô tìm; khách mới ưu tiên Flash + Bán chạy + Danh mục, kèm "Quà khách mới". Cờ
 * `homeNewCustomerLayout` đưa Quà khách mới + Danh mục lên trước giờ vàng. Khối lỗi tải hiện thông báo gọn + "Thử lại" ngay tại chỗ,
 * độc lập từng khối; cả ba lưới công khai lỗi thì một dải lỗi cấp trang thay cho từng thẻ lỗi.
 */
export default function HomeView({ initial = {} }: { initial?: HomeInitial }) {
  const qc = useQueryClient();
  const router = useRouter();
  const authed = useAuthPhase() === 'authenticated';
  const userId = useAuth().user?.id;

  // Chuông ở đây dùng chung queryKey ['notifications'] với trang Thông báo.
  const unreadCount = useQuery({ ...notificationsQuery(coreHttp), enabled: authed }).data?.filter((n) => n.status !== 'READ').length ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới. Trong lúc tải dùng loại đã nhớ
  // của tài khoản này để thứ tự khối không đổi sau khung hình đầu (useHomeCustomerKind).
  const purchasedRaw = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const purchased = useBlockQuery(purchasedRaw);
  const kind = useHomeCustomerKind(authed, userId, purchasedRaw);
  // Bố cục mới cho khách mới đi sau cờ cấu hình, mặc định tắt: cấu hình chưa về hay lỗi thì giữ thứ tự cũ.
  const publicConfig = usePublicConfig();
  const newCustomerLayout = publicConfig.isLoaded && publicConfig.homeNewCustomerLayout === true;

  // useBlockQuery: tải lại khi đang lỗi (Thử lại) không được đổi khối lỗi thành khung chờ (React Query v5).
  const bestSellers = useBlockQuery(useQuery({ ...homeBestSellerQuery(coreHttp), ...withInitial(initial.bestSellers) }));
  const featured = useBlockQuery(useQuery({ ...homeFeaturedQuery(coreHttp), ...withInitial(initial.featured) }));
  const newest = useBlockQuery(useQuery({ ...homeNewestQuery(coreHttp), ...withInitial(initial.newest) }));
  // Feed "Dành cho bạn" cá nhân hoá, cần đăng nhập. select() bọc thành { data } để dùng chung HomeSection.
  const forYou = useBlockQuery(useQuery({ ...forYouQuery(coreHttp), enabled: authed, select: (data) => ({ data }) }));
  const categories = useQuery({ ...categoriesQuery(coreHttp), staleTime: STALE, retry: false, ...(initial.categories ? { initialData: initial.categories } : {}) });
  const entries = useMemo(() => categoryEntries(categories.data), [categories.data]);

  // Với khách chưa có lịch sử, "Dành cho bạn" rơi về SP nổi bật — trùng "Tubu chọn cho bạn". Chỉ bỏ trùng được khi đã biết
  // "Dành cho bạn" → chờ nó xong (isPending) thì mới hiện, để khối không đổi số ô lúc dữ liệu về; sau khi bỏ trùng mới cắt về SECTION_LIMIT.
  const forYouIds = useMemo(() => new Set((forYou.data?.data ?? []).map((p) => p.id)), [forYou.data]);
  const featuredQuery: SectionQuery = {
    isLoading: featured.isLoading || (authed && forYou.isPending),
    isError: featured.isError,
    error: featured.error,
    isFetching: featured.isFetching,
    refetch: featured.refetch,
    data: featured.data ? { data: dedupeAgainst(featured.data.data, forYouIds).slice(0, SECTION_LIMIT) } : undefined,
  };

  // API sập hẳn: cả ba lưới SP công khai đều lỗi và chưa có gì để hiện → một dải lỗi cấp trang thay cho từng thẻ lỗi của kệ.
  const publicGrids = [bestSellers, featured, newest];
  const pageDown = publicGrids.every((b) => b.isError && b.data === undefined);

  const blocks: Record<HomeBlockId, ReactNode> = {
    search: <SearchRow unreadCount={unreadCount} authed={authed} />,
    // Lỗi thật → khối lỗi + Thử lại; 404 = API cũ chưa có endpoint → ẩn như trước (kệ này vốn tuỳ chọn).
    purchased:
      purchased.isError && !purchased.data && !isEndpointMissing(purchased.error) ? (
        <HomeBlockError title={reorderText.railTitle} error={purchased.error} onRetry={purchased.refetch} retrying={purchased.isFetching} />
      ) : (
        <PurchasedRail />
      ),
    // Khách mới: ô này rỗng và "Quà khách mới" phải là khối đầu sau ô tìm, nên dải đi cùng khối welcome; khách cũ thấy dải ngay sau dải đơn.
    orderStrip: (
      <>
        <OrderStrip />
        {kind === 'returning' && <PointsBoostStrip />}
      </>
    ),
    flash: (
      <>
        <FlashSale />
        <UpcomingFlashSales />
      </>
    ),
    forYou: authed ? <HomeSection title={homeText.forYou} query={forYou} limit={SECTION_LIMIT} /> : null,
    bestSellers: (
      <HomeSection title={homeText.bestSellers} query={bestSellers} limit={SECTION_LIMIT} seeAllTo={browseHref({ ...EMPTY_SEARCH_STATE, sort: 'best_seller' })} priority />
    ),
    categories: (
      <CategoryGrid
        entries={entries}
        isLoading={categories.isLoading}
        onSelect={(e) =>
          router.push(browseHref({ ...EMPTY_SEARCH_STATE, ...(e.kind === 'category' ? { category: e.key } : { segment: e.key }) }))
        }
      />
    ),
    recentlyViewed: <RecentlyViewedRail />,
    featured: <HomeSection title={homeText.featured} query={featuredQuery} limit={SECTION_LIMIT} seeAllTo={browseHref(EMPTY_SEARCH_STATE)} />,
    newArrivals: (
      <HomeSection title={homeText.newArrivals} query={newest} limit={SECTION_LIMIT} seeAllTo={browseHref({ ...EMPTY_SEARCH_STATE, sort: 'newest' })} />
    ),
    extras: <HomeExtras initialBrands={initial.brands} />,
    // Khách cũ không bao giờ thấy khối này nên không gọi API ưu đãi khách mới.
    welcome:
      kind === 'new' ? (
        <>
          <NewCustomerGift />
          <PointsBoostStrip omitPlain />
        </>
      ) : null,
  };

  return (
    <HomeBlockErrorSuppressed.Provider value={pageDown}>
      {homeBlockOrder(kind, newCustomerLayout).map((id) => (
        <Fragment key={id}>
          <div data-home-block={id}>{blocks[id]}</div>
          {pageDown && id === 'search' && (
            <div data-home-block="pageError">
              <HomePageError error={bestSellers.error} retrying={publicGrids.some((b) => b.isFetching)} onRetry={() => refreshHomeQueries(qc)} />
            </div>
          )}
        </Fragment>
      ))}
    </HomeBlockErrorSuppressed.Provider>
  );
}

/** Ô tìm ở Trang chủ chỉ là vỏ: mở thẳng bàn phím ở ô thật bên /san-pham (?focus=search). Chuông thông báo chỉ khi đã đăng nhập. */
function SearchRow({ unreadCount, authed }: { unreadCount: number; authed: boolean }) {
  return (
    <div className="flex items-center gap-2 pb-3">
      <Link
        href="/san-pham?focus=search"
        aria-label={homeText.searchPlaceholder}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-stone-300 bg-stone-0 px-4 py-2.5 shadow-card transition hover:border-stone-450"
      >
        <Search className="h-4 w-4 flex-none text-stone-600" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm text-stone-600">{homeText.searchPlaceholder}</span>
      </Link>
      {authed && isWebRouteReady('/tai-khoan/thong-bao') && (
        <Link
          href="/tai-khoan/thong-bao"
          aria-label={unreadCount > 0 ? homeText.notificationsUnread(unreadCount) : homeText.notifications}
          className="relative inline-flex h-11 w-11 flex-none items-center justify-center rounded-full bg-forest-50 text-forest-700 transition hover:bg-forest-100"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              role="img"
              aria-label={homeText.unreadBadge(unreadCount)}
              className="absolute -right-0.5 -top-0.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-promo-solid px-1 text-xs font-bold text-stone-900"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
      )}
    </div>
  );
}
