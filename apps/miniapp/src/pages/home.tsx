import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchUpcomingFlashSales } from '../services/shop-api';
import { coreHttp } from '../services/core-http';
import { useAuthStore } from '../store/auth';
import { useCategories } from '../hooks/use-categories';
import { useHomeBanners } from '../hooks/use-home-banners';
import { useHomeCustomerKind } from '../hooks/use-home-customer-kind';
import { usePurchasedItems } from '../hooks/use-purchased-items';
import { FlashSale } from '../components/flash-sale';
import { PullToRefresh } from '../components/pull-to-refresh';
import { PURCHASED_RAIL_LIMIT } from '../components/reorder/purchased-rail';
import {
  HomeBestSellerRail,
  HomeBrandJourney,
  HomeCommunityPreview,
  HomeNewCustomerGift,
  HomePurchasedRail,
  HomeSuggestFeed,
  loadHomeBelow,
  useHomeBelow,
  retryHomeBelow,
} from '../components/home/home-lazy';
import { CategoryRow } from '../components/home/category-row';
import { MemberCard, MemberCardSkeleton, MemberCardUnavailable } from '../components/home/member-card';
import { ShortcutGrid } from '../components/home/shortcut-grid';
import { TodoStrip, useHomeTodoQueries } from '../components/home/todo-strip';
import { HomeSettlingSkeleton } from '../components/home/home-settling';
import { useHomeSettling } from '../components/home/use-home-settling';
import { HomeBlockErrorSuppressed } from '../components/home/home-block-error';
import { HomePageError } from '../components/home/home-page-error';
import { HomeBanner } from '../components/home/home-banner';
import { HomeCombos } from '../components/home/home-combos';
import { HomeHeader } from '../components/home/home-header';
import { useHomeShelves } from '../components/home/use-home-shelves';
import { useHomeFeed } from '../components/home/use-home-feed';
import { refreshHomeQueries } from '../components/home/home-blocks';
import { categorySkeletonCells, homeRenderOrder, readBannerHint, type HomeRenderBlock } from '@tubutree/app-core/home-layout';
import { unreadNotificationCountQuery } from '@tubutree/app-core/queries/account';
import { haptic } from '../utils/haptic';
import { browserStorage } from '../utils/recently-viewed';

/**
 * Trang chủ (màn đầu gọn, món hàng lên đầu): header dính 56px (logo, ô tìm, chuông, giỏ) → thẻ thành viên một dòng (khách cũ) hoặc dải Quà khách mới
 * → Việc cần làm → banner chiến dịch (ẩn hẳn khi không có) → 4 lối tắt + "Tất cả" → Giờ vàng → Mua lại (khách cũ) → Danh mục lưới 2×5 → Bán chạy nhất có hạng → combo
 * → Hành trình nguyên liệu → Cộng đồng (chỉ đọc) → MỘT lưới Gợi ý hôm nay cuộn vô tận. Thứ tự khối ở app-core (`homeBlockOrder`), dùng chung với web;
 * `useHomeShelves` chống trùng món giữa các kệ hàng. Khối lỗi tải hiện thông báo gọn + "Thử lại" ngay tại chỗ (C-084), độc lập từng khối; kéo để làm mới vẫn dùng được.
 */
// Chunk các khối dưới màn đầu tải song song với dữ liệu ngay khi mã trang chủ chạy, không đợi tới lúc render. Mã này chạy cả khi app mở thẳng
// vào trang khác (deep link) vì Trang chủ nằm trong gói đầu; chunk hỏng ở đó thì khi khách về Trang chủ sẽ thấy dải lỗi có "Thử lại" (tải lại
// app với lỗi kiểu chunk). Thẻ sản phẩm đầu không phụ thuộc chunk: khung chờ chung không đợi nó.
void loadHomeBelow().catch(() => {});

export default function HomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  useHomeFeed();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const restoring = useAuthStore((s) => s.status === 'loading');
  const sessionFailed = useAuthStore((s) => s.status === 'error');
  const userId = useAuthStore((s) => s.user?.id);
  // Voucher sinh nhật, nhắc giỏ, hoa hồng duyệt đều nằm trong Thông báo nên chuông phải báo. Đếm cả hộp thư (không dừng ở 50 tin đầu), chung
  // queryKey với Cá nhân và trang Thông báo, và không tải danh sách tin chỉ để đếm.
  const unreadCount = useQuery({ ...unreadNotificationCountQuery(coreHttp), enabled: authed }).data?.count ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới. Trong lúc tải dùng loại đã nhớ
  // của tài khoản này để thứ tự khối không đổi sau khung hình đầu (useHomeCustomerKind).
  const purchasedRaw = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const resolvedKind = useHomeCustomerKind(authed, userId, purchasedRaw, restoring || sessionFailed);
  // Phiên lỗi mà máy chưa nhớ loại khách: không còn gì để chờ, dùng bố cục khách mới mặc định.
  const kind = sessionFailed && resolvedKind === 'unknown' ? 'new' : resolvedKind;
  const restore = useAuthStore((s) => s.restore);

  // Dữ liệu chung của các kệ hàng (Giờ vàng, Mua lại, Bán chạy nhất): cùng khoá query với khối nên không thêm request, chống trùng ở một chỗ.
  const shelves = useHomeShelves(kind);
  const categories = useCategories();

  // Lần mở đầu chưa biết loại khách: các khối dưới thẻ thành viên chờ dữ liệu quyết định hình dạng của chúng rồi hiện cùng lúc, nên tải sớm các
  // query mà khối nào cũng sẽ dùng (cùng khoá, không thêm request).
  // Khối Giờ vàng đọc cùng khoá này cho dòng "suất kế"; công khai nên khách chưa đăng nhập cũng tải.
  const upcoming = useQuery({ queryKey: ['flash-sales', 'upcoming'], queryFn: fetchUpcomingFlashSales, staleTime: 30_000, enabled: !restoring });
  const todo = useHomeTodoQueries();
  const belowState = useHomeBelow();
  // Cùng khoá query với HomeBanner (không thêm request): khung chờ chung phải chờ cả banner, vì khối thật chưa mount trong lúc giữ khung chờ.
  const banners = useHomeBanners(kind);
  const [bannerHint] = useState(() => readBannerHint(browserStorage()));
  const settling = useHomeSettling(
    kind,
    todo.loading || shelves.flashQuery.isLoading || upcoming.isLoading || categories.isLoading || banners.loading,
    sessionFailed,
  );

  // API sập hẳn: kệ Bán chạy nhất (mọi loại khách đều thấy) lỗi và chưa có gì để hiện → một dải lỗi cấp trang thay cho từng thẻ lỗi.
  const pageDown = shelves.bestSellerQuery.isError && shelves.bestSellerQuery.data === undefined;

  const refreshAll = () => {
    if (belowState.failed) retryHomeBelow();
    return refreshHomeQueries(qc);
  };

  const blocks: Record<HomeRenderBlock, ReactNode> = {
    settling: <HomeSettlingSkeleton categoryCells={categorySkeletonCells(categories.placeholderCount)} banner={bannerHint} />,
    search: <HomeHeader unreadCount={unreadCount} />,
    member:
      kind === 'returning' && sessionFailed ? (
        <MemberCardUnavailable onRetry={() => void restore()} />
      ) : kind === 'unknown' || (kind === 'returning' && restoring) ? (
        <MemberCardSkeleton />
      ) : kind === 'returning' ? (
        <MemberCard />
      ) : null,
    todo: <TodoStrip restoring={restoring} />,
    // Khách cũ không bao giờ thấy khối này nên không gọi API ưu đãi khách mới.
    welcome: kind === 'new' ? <HomeNewCustomerGift /> : null,
    // Banner và combo tự ẩn khi không có dữ liệu, không giữ chỗ.
    banner: <HomeBanner kind={kind} />,
    combos: <HomeCombos views={shelves.combos} />,
    shortcuts: <ShortcutGrid />,
    // Lỗi tải Mua lại (kể cả 404 của API cũ) đưa trang về bố cục khách mới, nơi khối này không có mặt, nên khối tự có trạng thái lỗi riêng ở PurchasedRail.
    purchased: <HomePurchasedRail source="home_rail" restoring={restoring} excludeVariations={shelves.flashVariationIds} />,
    flash: (
      <FlashSale
        items={shelves.flash}
        loading={shelves.flashQuery.isLoading}
        error={shelves.flashQuery.error}
        onRetry={shelves.flashQuery.refetch}
        retrying={shelves.flashQuery.isFetching}
        onExpire={shelves.onFlashEnd}
      />
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
        onSeeAll={() => {
          haptic('light');
          navigate('/browse');
        }}
      />
    ),
    bestSellers: (
      <HomeBestSellerRail
        items={shelves.bestSellers}
        ranks={shelves.bestSellerRanks}
        basis={shelves.bestSellerBasis}
        loading={shelves.bestSellerQuery.isLoading}
        error={shelves.bestSellerQuery.error}
        onRetry={shelves.bestSellerQuery.refetch}
        retrying={shelves.bestSellerQuery.isFetching}
      />
    ),
    journey: <HomeBrandJourney />,
    community: <HomeCommunityPreview />,
    suggest: <HomeSuggestFeed exclude={shelves.seen} />,
  };

  return (
    // `.page` giữ đệm safe-top của chế độ immersive (actionBar Zalo đã ẩn).
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 72 }}>
      <PullToRefresh onRefresh={refreshAll} />
      <HomeBlockErrorSuppressed.Provider value={pageDown}>
        {homeRenderOrder(kind, settling).map((id) => (
          <Fragment key={id}>
            <div data-home-block={id} style={id === 'search' ? STICKY_HEADER : id === 'settling' ? undefined : BLOCK_GAP}>
              {blocks[id]}
            </div>
            {(pageDown || belowState.failed) && id === 'search' && (
              <div data-home-block="pageError">
                <HomePageError
                  error={pageDown ? shelves.bestSellerQuery.error : belowState.error}
                  retrying={pageDown && shelves.bestSellerQuery.isFetching}
                  onRetry={refreshAll}
                />
              </div>
            )}
          </Fragment>
        ))}
      </HomeBlockErrorSuppressed.Provider>
    </Page>
  );
}

// Header dính đầu trang khi cuộn (đứng thẳng dưới vùng an toàn); phải là con trực tiếp của trang cuộn nên áp lên chính khối bọc, không phải bên trong.
const STICKY_HEADER: CSSProperties = { position: 'sticky', top: 'var(--safe-top)', zIndex: 20, background: 'var(--color-bg-canvas)' };

// Khoảng cách giữa khối đặt ở vỏ khối (CS-05), khối con không tự đặt đệm trên/dưới. Khối rỗng (không dữ liệu) có lề sập qua nên không để lại khoảng trống.
const BLOCK_GAP: CSSProperties = { marginTop: 'var(--space-block)' };
