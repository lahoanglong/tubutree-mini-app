import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { fetchProducts } from '../services/shop-api';
import { getNotifications } from '../services/account-api';
import { useAuthStore } from '../store/auth';
import { useCategories } from '../hooks/use-categories';
import { useHomeCustomerKind } from '../hooks/use-home-customer-kind';
import { usePurchasedItems } from '../hooks/use-purchased-items';
import { FlashSale, UpcomingFlashSales } from '../components/flash-sale';
import { PullToRefresh } from '../components/pull-to-refresh';
import { PURCHASED_RAIL_LIMIT, PurchasedRail } from '../components/reorder/purchased-rail';
import { BestSellerRail, BEST_SELLER_LIMIT } from '../components/home/best-seller-rail';
import { BrandJourney } from '../components/home/brand-journey';
import { CategoryRow } from '../components/home/category-row';
import { CommunityPreview } from '../components/home/community-preview';
import { MemberCard, MemberCardSkeleton } from '../components/home/member-card';
import { NewCustomerGift } from '../components/home/new-customer-gift';
import { ShortcutGrid } from '../components/home/shortcut-grid';
import { SuggestFeed } from '../components/home/suggest-feed';
import { TodoStrip } from '../components/home/todo-strip';
import { HomeBlockErrorSuppressed } from '../components/home/home-block-error';
import { HomePageError } from '../components/home/home-page-error';
import { HomeHeader } from '../components/home/home-header';
import { useBlockQuery } from '../components/home/use-block-query';
import { useHomeFeed } from '../components/home/use-home-feed';
import { homeBlockOrder, refreshHomeQueries, type HomeBlockId } from '../components/home/home-blocks';
import { Icon } from '../components/ui/icon';
import { Text } from '../components/ui/text';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';

/**
 * Trang chủ (màn đầu gọn, món hàng lên đầu). Ô tìm dính đầu trang. Khách cũ: thẻ thành viên một dòng (Điểm danh) → Việc cần làm → một hàng
 * lối tắt → Mua lại → Giờ vàng → Danh mục một hàng → Hành trình nguyên liệu → Cộng đồng (chỉ đọc) → MỘT lưới gợi ý cuộn vô tận. Khách mới/vãng
 * lại: dải "Quà khách mới" thay thẻ thành viên, không có Mua lại, Giờ vàng và Bán chạy đứng trước Danh mục. Thứ tự khối ở app-core (`homeBlockOrder`), dùng chung với web.
 * Khối lỗi tải hiện thông báo gọn + "Thử lại" ngay tại chỗ (C-084), độc lập từng khối; kéo để làm mới vẫn dùng được.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  useHomeFeed();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const restoring = useAuthStore((s) => s.status === 'loading');
  const userId = useAuthStore((s) => s.user?.id);
  // Chuông ở đây trước đây trơ, không báo gì — trong khi voucher sinh nhật, nhắc giỏ, hoa hồng
  // duyệt đều nằm trong Thông báo. Dùng chung queryKey với trang Thông báo (P1-8 audit mạch lạc).
  const unreadCount =
    useQuery({ queryKey: ['notifications'], queryFn: getNotifications, enabled: authed }).data?.filter((n) => n.status !== 'READ').length ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới. Trong lúc tải dùng loại đã nhớ
  // của tài khoản này để thứ tự khối không đổi sau khung hình đầu (useHomeCustomerKind).
  const purchasedRaw = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const kind = useHomeCustomerKind(authed, userId, purchasedRaw, restoring);

  // Cùng khoá với kệ Bán chạy của khách mới: ở đây chỉ để biết API sập hẳn (dải lỗi cấp trang), không thêm request.
  const bestSellers = useBlockQuery(
    useQuery({
      queryKey: ['products', 'home-best-seller'],
      queryFn: () => fetchProducts({ limit: BEST_SELLER_LIMIT, sort: 'best_seller' }),
      enabled: kind === 'new',
    }),
  );
  const categories = useCategories();

  // API sập hẳn: chỉ tính khi khách đang THẤY kệ Bán chạy (khách mới) mà kệ lỗi và chưa có gì để hiện → một dải lỗi cấp trang thay
  // cho từng thẻ lỗi. Khách cũ không thấy kệ này nên không bao giờ nhận dải lỗi vì nó.
  const pageDown = kind === 'new' && bestSellers.isError && bestSellers.data === undefined;

  const blocks: Record<HomeBlockId, ReactNode> = {
    search: <SearchShell />,
    member: kind === 'unknown' || (kind === 'returning' && restoring) ? <MemberCardSkeleton /> : kind === 'returning' ? <MemberCard /> : null,
    todo: <TodoStrip restoring={restoring} />,
    // Khách cũ không bao giờ thấy khối này nên không gọi API ưu đãi khách mới.
    welcome: kind === 'new' ? <NewCustomerGift /> : null,
    shortcuts: <ShortcutGrid />,
    // Lỗi tải Mua lại (kể cả 404 của API cũ) đưa trang về bố cục khách mới, nơi khối này không có mặt, nên khối tự có trạng thái lỗi riêng ở PurchasedRail.
    purchased: <PurchasedRail source="home_rail" restoring={restoring} />,
    flash: (
      <>
        <FlashSale />
        <UpcomingFlashSales />
      </>
    ),
    categories: (
      <CategoryRow
        entries={categories.entries}
        isLoading={categories.isLoading}
        placeholderCount={categories.placeholderCount}
        onSelect={(e) => {
          haptic('light');
          navigate(e.kind === 'category' ? `/browse?category=${encodeURIComponent(e.key)}` : `/browse?segment=${encodeURIComponent(e.key)}`);
        }}
      />
    ),
    bestSellers: <BestSellerRail />,
    journey: <BrandJourney />,
    community: <CommunityPreview />,
    suggest: <SuggestFeed />,
  };

  return (
    // `.page` giữ đệm safe-top của chế độ immersive (actionBar Zalo đã ẩn).
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 72 }}>
      <PullToRefresh onRefresh={() => refreshHomeQueries(qc)} />
      <HomeHeader unreadCount={unreadCount} />
      <HomeBlockErrorSuppressed.Provider value={pageDown}>
        {homeBlockOrder(kind).map((id) => (
          <Fragment key={id}>
            <div data-home-block={id} style={id === 'search' ? STICKY_SEARCH : undefined}>
              {blocks[id]}
            </div>
            {pageDown && id === 'search' && (
              <div data-home-block="pageError">
                <HomePageError
                  error={bestSellers.error}
                  retrying={bestSellers.isFetching}
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

// Dính đầu trang khi cuộn (đứng thẳng dưới vùng an toàn); phải là con trực tiếp của trang cuộn nên áp lên chính khối bọc, không phải bên trong.
const STICKY_SEARCH: CSSProperties = { position: 'sticky', top: 'var(--safe-top)', zIndex: 20, background: 'var(--color-bg-canvas)' };

/** Ô tìm ở Trang chủ chỉ là vỏ: mở thẳng bàn phím ở ô thật bên /browse (?focus=search). */
function SearchShell() {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '0 16px 8px' }}>
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
