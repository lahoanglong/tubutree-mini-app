import { useMemo, type ReactNode } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { fetchForYou, fetchProducts } from '../services/shop-api';
import { getNotifications } from '../services/account-api';
import { useAuthStore } from '../store/auth';
import { useCategories } from '../hooks/use-categories';
import { usePurchasedItems } from '../hooks/use-purchased-items';
import { FlashSale, UpcomingFlashSales } from '../components/flash-sale';
import { PullToRefresh } from '../components/pull-to-refresh';
import { CategoryGrid } from '../components/catalog/category-grid';
import { RecentlyViewedRail } from '../components/catalog/recently-viewed-rail';
import { PURCHASED_RAIL_LIMIT, PurchasedRail } from '../components/reorder/purchased-rail';
import { HomeExtras } from '../components/home/home-extras';
import { HomeHeader } from '../components/home/home-header';
import { HomeSection, type SectionQuery } from '../components/home/home-section';
import { OrderStrip } from '../components/home/order-strip';
import { customerKind, dedupeAgainst, homeBlockOrder, refreshHomeQueries, type HomeBlockId } from '../components/home/home-blocks';
import { Icon } from '../components/ui/icon';
import { Text } from '../components/ui/text';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

const SECTION_LIMIT = 6;

/**
 * Trang chủ (spec 5b.1) — DS v2 toàn trang. Thứ tự khối theo khách cũ/mới (`homeBlockOrder`):
 * khách cũ thấy "Mua lại" ngay dưới ô tìm; khách mới ưu tiên Flash + Bán chạy + Danh mục.
 * Lưới SP đầu tiên nằm trong 5 khối đầu (trước đây là khối thứ 11 — A2-32). Ngoại lệ chấp nhận: khách cũ
 * chưa có "Dành cho bạn" thì lưới SP đầu tiên là "Bán chạy" ở khối thứ 6.
 * Khối lỗi tải tự ẩn (không ErrorState ở vùng nhìn thấy đầu tiên); kéo để làm mới là cách thử lại.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  // Chuông ở đây trước đây trơ, không báo gì — trong khi voucher sinh nhật, nhắc giỏ, hoa hồng
  // duyệt đều nằm trong Thông báo. Dùng chung queryKey với trang Thông báo (P1-8 audit mạch lạc).
  const unreadCount =
    useQuery({ queryKey: ['notifications'], queryFn: getNotifications, enabled: authed }).data?.filter((n) => n.status !== 'READ').length ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới.
  const purchased = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const kind = customerKind(purchased.data?.items.length);

  const bestSellers = useQuery({
    queryKey: ['products', 'home-best-seller'],
    queryFn: () => fetchProducts({ limit: SECTION_LIMIT, sort: 'best_seller' }),
  });
  const featured = useQuery({ queryKey: ['products', 'home-featured'], queryFn: () => fetchProducts({ limit: SECTION_LIMIT }) });
  const newest = useQuery({ queryKey: ['products', 'home-newest'], queryFn: () => fetchProducts({ limit: SECTION_LIMIT, sort: 'newest' }) });
  // Feed "Dành cho bạn" cá nhân hoá, cần đăng nhập. select() bọc thành { data } để dùng chung HomeSection.
  const forYou = useQuery({ queryKey: ['for-you'], queryFn: fetchForYou, enabled: authed, select: (data) => ({ data }) });
  const categories = useCategories();

  // A2-32: với khách chưa có lịch sử, "Dành cho bạn" rơi về SP nổi bật — trùng "Tubu chọn cho bạn".
  const forYouIds = useMemo(() => new Set((forYou.data?.data ?? []).map((p) => p.id)), [forYou.data]);
  const featuredQuery: SectionQuery = {
    isLoading: featured.isLoading,
    isError: featured.isError,
    error: featured.error,
    data: featured.data ? { data: dedupeAgainst(featured.data.data, forYouIds) } : undefined,
  };

  const blocks: Record<HomeBlockId, ReactNode> = {
    search: <SearchShell />,
    purchased: <PurchasedRail source="home_rail" />,
    orderStrip: <OrderStrip />,
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
  };

  return (
    // `.page` giữ đệm safe-top của chế độ immersive (actionBar Zalo đã ẩn).
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 72 }}>
      <PullToRefresh onRefresh={() => refreshHomeQueries(qc)} />
      <HomeHeader unreadCount={unreadCount} />
      {homeBlockOrder(kind).map((id) => (
        <div key={id} data-home-block={id}>
          {blocks[id]}
        </div>
      ))}
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
