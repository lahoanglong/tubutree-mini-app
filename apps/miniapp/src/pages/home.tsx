import { Fragment, useMemo, type ReactNode } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { fetchForYou, fetchProducts } from '../services/shop-api';
import { getNotifications } from '../services/account-api';
import { useAuthStore } from '../store/auth';
import { useCategories } from '../hooks/use-categories';
import { useHomeCustomerKind } from '../hooks/use-home-customer-kind';
import { usePublicConfig } from '../hooks/use-public-config';
import { usePurchasedItems } from '../hooks/use-purchased-items';
import { FlashSale, UpcomingFlashSales } from '../components/flash-sale';
import { PullToRefresh } from '../components/pull-to-refresh';
import { CategoryGrid } from '../components/catalog/category-grid';
import { RecentlyViewedRail } from '../components/catalog/recently-viewed-rail';
import { PURCHASED_RAIL_LIMIT, PurchasedRail } from '../components/reorder/purchased-rail';
import { HomeExtras } from '../components/home/home-extras';
import { NewCustomerGift } from '../components/home/new-customer-gift';
import { PointsBoostStrip } from '../components/loyalty/points-boost-strip';
import { HomeBlockError, HomeBlockErrorSuppressed } from '../components/home/home-block-error';
import { HomePageError } from '../components/home/home-page-error';
import { HomeHeader } from '../components/home/home-header';
import { HomeSection, type SectionQuery } from '../components/home/home-section';
import { useBlockQuery } from '../components/home/use-block-query';
import { OrderStrip } from '../components/home/order-strip';
import { useHomeFeed } from '../components/home/use-home-feed';
import { dedupeAgainst, homeBlockOrder, isEndpointMissing, refreshHomeQueries, type HomeBlockId } from '../components/home/home-blocks';
import { Icon } from '../components/ui/icon';
import { Text } from '../components/ui/text';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

const SECTION_LIMIT = 6;
// "Tubu chọn cho bạn" bỏ SP trùng "Dành cho bạn" rồi mới cắt về SECTION_LIMIT → xin dư để vẫn đủ ô sau khi bỏ trùng.
const FEATURED_FETCH_LIMIT = SECTION_LIMIT * 2;

/**
 * Trang chủ (spec 5b.1) — DS v2 toàn trang. Thứ tự khối theo khách cũ/mới (`homeBlockOrder`):
 * khách cũ thấy "Mua lại" ngay dưới ô tìm; khách mới ưu tiên Flash + Bán chạy + Danh mục, kèm khối "Quà khách mới".
 * Lưới SP đầu tiên nằm trong 5 khối đầu (trước đây là khối thứ 11 — A2-32). Ngoại lệ chấp nhận: khách cũ
 * chưa có "Dành cho bạn" thì lưới SP đầu tiên là "Bán chạy" ở khối thứ 6.
 * Khối lỗi tải hiện thông báo gọn + "Thử lại" ngay tại chỗ (C-084), độc lập từng khối; kéo để làm mới vẫn dùng được.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  useHomeFeed();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const userId = useAuthStore((s) => s.user?.id);
  // Chuông ở đây trước đây trơ, không báo gì — trong khi voucher sinh nhật, nhắc giỏ, hoa hồng
  // duyệt đều nằm trong Thông báo. Dùng chung queryKey với trang Thông báo (P1-8 audit mạch lạc).
  const unreadCount =
    useQuery({ queryKey: ['notifications'], queryFn: getNotifications, enabled: authed }).data?.filter((n) => n.status !== 'READ').length ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới. Trong lúc tải dùng loại đã nhớ
  // của tài khoản này để thứ tự khối không đổi sau khung hình đầu (useHomeCustomerKind).
  const purchasedRaw = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const purchased = useBlockQuery(purchasedRaw);
  const kind = useHomeCustomerKind(authed, userId, purchasedRaw);
  // Bố cục mới cho khách mới (D7 việc 1) đi sau cờ cấu hình, mặc định tắt: cấu hình chưa về hay lỗi thì giữ thứ tự cũ.
  const publicConfig = usePublicConfig();
  const newCustomerLayout = publicConfig.isLoaded && publicConfig.homeNewCustomerLayout === true;

  // useBlockQuery: tải lại khi đang lỗi (Thử lại, kéo làm mới) không được đổi khối lỗi thành khung chờ (React Query v5).
  const bestSellers = useBlockQuery(
    useQuery({
      queryKey: ['products', 'home-best-seller'],
      queryFn: () => fetchProducts({ limit: SECTION_LIMIT, sort: 'best_seller' }),
    }),
  );
  const featured = useBlockQuery(useQuery({ queryKey: ['products', 'home-featured'], queryFn: () => fetchProducts({ limit: FEATURED_FETCH_LIMIT }) }));
  const newest = useBlockQuery(
    useQuery({ queryKey: ['products', 'home-newest'], queryFn: () => fetchProducts({ limit: SECTION_LIMIT, sort: 'newest' }) }),
  );
  // Feed "Dành cho bạn" cá nhân hoá, cần đăng nhập. select() bọc thành { data } để dùng chung HomeSection.
  const forYou = useBlockQuery(useQuery({ queryKey: ['for-you'], queryFn: fetchForYou, enabled: authed, select: (data) => ({ data }) }));
  const categories = useCategories();

  // A2-32: với khách chưa có lịch sử, "Dành cho bạn" rơi về SP nổi bật — trùng "Tubu chọn cho bạn".
  // Chỉ bỏ trùng được khi đã biết "Dành cho bạn" → chờ nó xong (isPending) thì mới hiện, để khối không đổi số ô lúc dữ liệu về;
  // sau khi bỏ trùng mới cắt về SECTION_LIMIT.
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
  // Chỉ một phần lỗi thì vẫn là thẻ lỗi từng khối (thử lại đúng khối đó).
  const publicGrids = [bestSellers, featured, newest];
  const pageDown = publicGrids.every((b) => b.isError && b.data === undefined);

  const blocks: Record<HomeBlockId, ReactNode> = {
    search: <SearchShell />,
    // Lỗi thật → khối lỗi + Thử lại; 404 = API cũ chưa có endpoint → ẩn như trước (kệ này vốn tuỳ chọn).
    purchased:
      purchased.isError && !purchased.data && !isEndpointMissing(purchased.error) ? (
        <HomeBlockError title={vi.reorder.railTitle} error={purchased.error} onRetry={purchased.refetch} retrying={purchased.isFetching} />
      ) : (
        <PurchasedRail source="home_rail" />
      ),
    // Khách mới: ô này rỗng và "Quà khách mới" phải là khối đầu sau ô tìm, nên dải đi cùng khối welcome; khách cũ thấy dải ngay sau dải đơn.
    orderStrip: (
      <>
        <OrderStrip />
        {kind === 'returning' && <PointsBoostStrip placement="home" />}
      </>
    ),
    flash: (
      <>
        <FlashSale />
        <UpcomingFlashSales />
      </>
    ),
    forYou: authed ? <HomeSection title={vi.home.forYou} query={forYou} listSource="home_for_you" limit={SECTION_LIMIT} /> : null,
    bestSellers: (
      <HomeSection
        title={vi.home.bestSellers}
        query={bestSellers}
        listSource="home_best_seller"
        limit={SECTION_LIMIT}
        seeAllTo="/browse?sort=best_seller"
      />
    ),
    categories: (
      <CategoryGrid
        entries={categories.entries}
        isLoading={categories.isLoading}
        placeholderCount={categories.placeholderCount}
        onSelect={(e) => {
          haptic('light');
          navigate(e.kind === 'category' ? `/browse?category=${encodeURIComponent(e.key)}` : `/browse?segment=${encodeURIComponent(e.key)}`);
        }}
      />
    ),
    recentlyViewed: <RecentlyViewedRail />,
    featured: <HomeSection title={vi.home.featured} query={featuredQuery} listSource="home_featured" limit={SECTION_LIMIT} seeAllTo="/browse" />,
    newArrivals: (
      <HomeSection title={vi.home.newArrivals} query={newest} listSource="home_newest" limit={SECTION_LIMIT} seeAllTo="/browse?sort=newest" />
    ),
    extras: <HomeExtras />,
    // Khách cũ không bao giờ thấy khối này nên không gọi API ưu đãi khách mới.
    welcome:
      kind === 'new' ? (
        <>
          <NewCustomerGift />
          <PointsBoostStrip placement="home" omitPlain />
        </>
      ) : null,
  };

  return (
    // `.page` giữ đệm safe-top của chế độ immersive (actionBar Zalo đã ẩn).
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 72 }}>
      <PullToRefresh onRefresh={() => refreshHomeQueries(qc)} />
      <HomeHeader unreadCount={unreadCount} />
      <HomeBlockErrorSuppressed.Provider value={pageDown}>
        {homeBlockOrder(kind, newCustomerLayout).map((id) => (
          <Fragment key={id}>
            <div data-home-block={id}>{blocks[id]}</div>
            {pageDown && id === 'search' && (
              <div data-home-block="pageError">
                <HomePageError
                  error={bestSellers.error}
                  retrying={publicGrids.some((b) => b.isFetching)}
                  onRetry={() => refreshHomeQueries(qc)}
                />
              </div>
            )}
          </Fragment>
        ))}
      </HomeBlockErrorSuppressed.Provider>
    </Page>
  );
}

/** Ô tìm ở Trang chủ chỉ là vỏ: mở thẳng bàn phím ở ô thật bên /browse (?focus=search). */
function SearchShell() {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '0 16px 12px' }}>
      <button
        type="button"
        aria-label={vi.home.searchPlaceholder}
        className="tubu-press"
        onClick={() => {
          haptic('light');
          navigate('/browse?focus=search');
        }}
        style={{
          width: '100%',
          minHeight: 46,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '11px 16px',
          borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-surface)',
          boxShadow: 'var(--elevation-1)',
          boxSizing: 'border-box',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <Icon icon={Search} size="sm" tone="muted" />
        <Text variant="body-sm" tone="tertiary">
          {vi.home.searchPlaceholder}
        </Text>
      </button>
    </div>
  );
}
