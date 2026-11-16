import { Fragment, memo, useEffect, useMemo, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Page } from 'zmp-ui';
import { useSmartNavigate } from '../lib/smart-nav';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchUpcomingFlashSales } from '../services/shop-api';
import { useAuthStore } from '../store/auth';
import { useCategories } from '../hooks/use-categories';
import { useHomeBanners } from '../hooks/use-home-banners';
import { useHomeCustomerKind } from '../hooks/use-home-customer-kind';
import { useMeSummary } from '../hooks/use-me-summary';
import { usePurchasedItems } from '../hooks/use-purchased-items';
import { FlashSale, type FlashSaleProps } from '../components/flash-sale';
import { PullToRefresh } from '../components/pull-to-refresh';
import { PURCHASED_RAIL_LIMIT } from '../components/reorder/purchased-rail';
import {
  HomeBestSellerRail,
  HomeCommunityPreview,
  HomePurchasedRail,
  HomeQuiz,
  HomeSuggestFeed,
  HomeScrollRestoration,
  loadHomeBelow,
  useHomeBelow,
  retryHomeBelow,
} from '../components/home/home-lazy';
import { CategoryRow } from '../components/home/category-row';
import { HomeContextStrip } from '../components/home/context-strip';
import { ShortcutGrid } from '../components/home/shortcut-grid';
import { useHomeTodoQueries } from '../components/home/todo-strip';
import { HomeSettlingSkeleton } from '../components/home/home-settling';
import { useHomeSettling } from '../components/home/use-home-settling';
import { HomeBlockErrorSuppressed } from '../components/home/home-block-error';
import { HomePageError } from '../components/home/home-page-error';
import { HomeBanner } from '../components/home/home-banner';
import { HomeCombos } from '../components/home/home-combos';
import { HomeQuickAddProvider } from '../components/home/home-quick-add';
import { HomeStoryReel } from '../components/home/home-story-reel';
import { HomeHeader } from '../components/home/home-header';
import { useHomeShelves } from '../components/home/use-home-shelves';
import { useHomeFeed } from '../components/home/use-home-feed';
import { refreshHomeQueries } from '../components/home/home-blocks';
import { homeBestSellerQuery } from '../components/home/home-best-seller-query';
import {
  categorySkeletonCells,
  HOME_CONTEXT_HEIGHT,
  homeContextBlockName,
  homeContextVariant,
  homeInterleaveCard,
  homeRenderOrder,
  homeTodoCount,
  readBannerHint,
  readFlashHint,
  writeFlashHint,
  type HomeRenderBlock,
} from '@tubutree/app-core/home-layout';
import { vnDateSeed } from '@tubutree/app-core/home-suggest';
import { haptic } from '../utils/haptic';
import { browserStorage } from '../utils/recently-viewed';
import { serverNow } from '../utils/server-clock';

/**
 * Trang chủ gọn, tối đa 9 khối: header dính 56px (logo, ô tìm, chuông, giỏ) → MỘT dải ngữ cảnh cao 64px (Việc cần làm một dòng, Quà khách mới thu gọn hoặc thẻ thành viên)
 * → Danh mục một hàng → kệ Bán chạy nhất có hạng (thẻ đầu lộ trong màn đầu) → MỘT ô khuyến mãi (Giờ vàng đang chạy, không thì banner chiến dịch, không thì combo; không có gì thì ẩn)
 * → Mua lại (khách cũ) → hai thẻ chính + bốn ô phụ + lối tắt nhanh → dải Story → MỘT lưới Gợi ý hôm nay cuộn vô tận, có một thẻ chen sau 8 thẻ đầu (Chẩn đoán tổ ấm hoặc Cộng đồng,
 * luân phiên theo ngày). Thứ tự khối ở app-core (`homeRenderOrder`), dùng chung với web; `useHomeShelves` chống trùng món giữa các kệ hàng. Thẻ sản phẩm có nút ＋ thêm nhanh
 * (`HomeQuickAddProvider`). Khối lỗi tải hiện thông báo gọn + "Thử lại" ngay tại chỗ (C-084), độc lập từng khối; kéo để làm mới vẫn dùng được.
 */
// Chunk các khối dưới màn đầu tải song song với dữ liệu ngay khi mã trang chủ chạy, không đợi tới lúc render. Mã này chạy cả khi app mở thẳng
// vào trang khác (deep link) vì Trang chủ nằm trong gói đầu; chunk hỏng ở đó thì khi khách về Trang chủ sẽ thấy dải lỗi có "Thử lại" (tải lại
// app với lỗi kiểu chunk). Thẻ sản phẩm đầu không phụ thuộc chunk: khung chờ chung không đợi nó.
void loadHomeBelow().catch(() => {});

export default function HomePage() {
  const navigate = useSmartNavigate();
  const qc = useQueryClient();
  useHomeFeed();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const restoring = useAuthStore((s) => s.status === 'loading');
  const sessionFailed = useAuthStore((s) => s.status === 'error');
  const userId = useAuthStore((s) => s.user?.id);
  // Voucher sinh nhật, nhắc giỏ, hoa hồng duyệt đều nằm trong Thông báo nên chuông phải báo. Đếm cả hộp thư (không dừng ở 50 tin đầu), chung
  // query với Cá nhân và thanh đáy (/me/summary), và không tải danh sách tin chỉ để đếm.
  const unreadCount = useMeSummary({ select: (s) => s.unreadNotifications }).data ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới. Trong lúc tải dùng loại đã nhớ
  // của tài khoản này để thứ tự khối không đổi sau khung hình đầu (useHomeCustomerKind).
  const purchasedRaw = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const resolvedKind = useHomeCustomerKind(authed, userId, purchasedRaw, restoring || sessionFailed);
  // Phiên lỗi mà máy chưa nhớ loại khách: không còn gì để chờ, dùng bố cục khách mới mặc định.
  const kind = sessionFailed && resolvedKind === 'unknown' ? 'new' : resolvedKind;
  const restore = useAuthStore((s) => s.restore);

  // Gợi ý nhớ lần mở trước để ô khuyến mãi giữ chỗ đúng khối trong lúc dữ liệu về (không nhớ thì chờ im lặng): đọc một lần lúc mount, ghi do chính khối Giờ vàng và hook banner lo.
  const [flashRemembered] = useState(() => readFlashHint(browserStorage()));
  const [bannerRemembered] = useState(() => readBannerHint(browserStorage()));
  // Cùng khoá query với HomeBanner (không thêm request): ô khuyến mãi cần biết có banner không để chọn giữa banner và combo, và khung chờ chung phải chờ cả banner.
  const banners = useHomeBanners(kind);

  // Dữ liệu chung của các kệ hàng (Giờ vàng, Mua lại, Bán chạy nhất, combo): cùng khoá query với khối nên không thêm request, chống trùng ở một chỗ. `promo` là ô khuyến mãi được vẽ.
  const shelves = useHomeShelves(kind, {
    bannerSlides: banners.slides.length,
    bannerPending: banners.loading,
    bannerRemembered,
    flashRemembered,
  });
  const categories = useCategories();

  // Lần mở đầu chưa biết loại khách: các khối dưới dải ngữ cảnh chờ dữ liệu quyết định hình dạng của chúng rồi hiện cùng lúc, nên tải sớm các
  // query mà khối nào cũng sẽ dùng (cùng khoá, không thêm request).
  // Khối Giờ vàng và lối vào Giờ vàng đọc cùng khoá này cho "suất kế"; công khai nên khách chưa đăng nhập cũng tải.
  const upcoming = useQuery({ queryKey: ['flash-sales', 'upcoming'], queryFn: fetchUpcomingFlashSales, staleTime: 30_000, enabled: !restoring });
  const todo = useHomeTodoQueries();
  const belowState = useHomeBelow();
  const settling = useHomeSettling(
    kind,
    todo.loading || shelves.flashQuery.isLoading || upcoming.isLoading || categories.isLoading || banners.loading,
    sessionFailed,
  );

  // Dải ngữ cảnh: biến thể do app-core quyết (cùng web), cao đúng `HOME_CONTEXT_HEIGHT` ở mọi biến thể.
  const todoData = todo.todoQ.data;
  const contextVariant = homeContextVariant({ kind, todoCount: homeTodoCount(todoData), todoPending: todo.pending, todoRemembered: todo.remembered });

  // Còn Giờ vàng nào không: chưa biết (chưa tải xong suất đang chạy hay suất sắp tới) thì giữ cả thẻ lẫn lối tắt Giờ vàng, không rút rồi đổi hình.
  const flashQuery = shelves.flashQuery;
  const flashKnown = !flashQuery.isLoading && !(flashQuery.isError && flashQuery.data === undefined) && !upcoming.isPending && !(upcoming.isError && upcoming.data === undefined);
  const flashLive = flashKnown ? shelves.flash.length > 0 || (upcoming.data?.length ?? 0) > 0 : undefined;
  // Khối Giờ vàng chỉ gắn khi là ô khuyến mãi được chọn nên không ghi "không có" thay được: không ghi thì lần mở sau giữ khung chờ cho một Giờ vàng đã hết.
  const flashSettledEmpty = !flashQuery.isLoading && !flashQuery.isError && shelves.flash.length === 0;
  useEffect(() => {
    if (flashSettledEmpty) writeFlashHint(browserStorage(), false);
  }, [flashSettledEmpty]);

  // Thẻ chen trong lưới Gợi ý luân phiên theo ngày Việt Nam, cùng hạt giống ngày với lưới.
  const interleave = useMemo(() => (homeInterleaveCard(vnDateSeed(serverNow())) === 'quiz' ? <HomeQuiz /> : <HomeCommunityPreview />), []);

  // Quay lại từ PDP/danh mục về đúng chỗ đã cuộn (zmp Page gỡ trang cũ nên không tự giữ). Chỉ khôi phục khi các khối cao đã có dữ liệu thật, nếu không trang còn ngắn và vị trí bị kẹp.
  const scrollReady = !settling && !restoring && !categories.isLoading && !shelves.bestSellerQuery.isLoading;

  // API sập hẳn: kệ Bán chạy nhất (mọi loại khách đều thấy) lỗi và chưa có gì để hiện → một dải lỗi cấp trang thay cho từng thẻ lỗi.
  const pageDown = shelves.bestSellerQuery.isError && shelves.bestSellerQuery.data === undefined;

  const refreshAll = () => {
    if (belowState.failed) retryHomeBelow();
    return refreshHomeQueries(qc);
  };

  const bestSellerQuery = shelves.bestSellerQuery;
  // Chỉ phụ thuộc giá trị cần dựng khối (không phải đối tượng query hay shelves, đổi danh tính mỗi lần vẽ): khối không đổi thì giữ nguyên element để React bỏ qua.
  const blocks = useMemo<Record<HomeRenderBlock, ReactNode>>(() => ({
    settling: <HomeSettlingSkeleton categoryCells={categorySkeletonCells(categories.placeholderCount)} />,
    search: <HomeHeader unreadCount={unreadCount} />,
    context: <HomeContextStrip variant={contextVariant} restoring={restoring} sessionFailed={sessionFailed} todo={todoData} onRetrySession={() => void restore()} />,
    // Ô khuyến mãi: banner và combo tự ẩn khi không có dữ liệu, Giờ vàng chỉ vẽ khi `promo` chọn nó; không được chọn gì thì vỏ khối không có mặt.
    promo:
      shelves.promo === 'flash' ? (
        <FlashSaleBlock
          items={shelves.flash}
          loading={flashQuery.isLoading}
          error={flashQuery.error}
          onRetry={flashQuery.refetch}
          onExpire={shelves.onFlashEnd}
        />
      ) : shelves.promo === 'banner' ? (
        <HomeBanner kind={kind} />
      ) : shelves.promo === 'combos' ? (
        <HomeCombos views={shelves.combos} />
      ) : null,
    shortcuts: <ShortcutGrid flashLive={flashLive} />,
    // Dải Story tự tải Bán chạy nhất (cùng khoá với kệ Bán chạy nhất) và tự ẩn khi lỗi hoặc dưới 3 món; khi chờ giữ khung cao đúng khối thật.
    stories: <HomeStoryReel />,
    // Lỗi tải Mua lại (kể cả 404 của API cũ) đưa trang về bố cục khách mới, nơi khối này không có mặt, nên khối tự có trạng thái lỗi riêng ở PurchasedRail.
    purchased: <HomePurchasedRail source="home_rail" restoring={restoring} excludeVariations={shelves.flashVariationIds} />,
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
      <BestSellerBlock
        items={shelves.bestSellers}
        ranks={shelves.bestSellerRanks}
        basis={shelves.bestSellerBasis}
        loading={bestSellerQuery.isLoading}
        error={bestSellerQuery.error}
        onRetry={bestSellerQuery.refetch}
      />
    ),
    suggest: <HomeSuggestFeed exclude={shelves.seen} interleave={interleave} />,
    }), [
    kind, sessionFailed, restoring, restore, unreadCount, navigate, contextVariant, todoData, flashLive, interleave,
    categories.entries, categories.isLoading, categories.placeholderCount,
    shelves.promo, shelves.combos, shelves.flash, shelves.flashVariationIds, shelves.onFlashEnd, shelves.bestSellers, shelves.bestSellerRanks, shelves.bestSellerBasis, shelves.seen,
    flashQuery.isLoading, flashQuery.error, flashQuery.refetch, bestSellerQuery.isLoading, bestSellerQuery.error, bestSellerQuery.refetch,
  ]);

  return (
    // `.page` giữ đệm safe-top của chế độ immersive (actionBar Zalo đã ẩn).
    // resetScroll tắt: Page tự cuộn về 0 ở layout effect chạy sau hook khôi phục nên khung đầu sau Back vẽ ở đầu trang; hook tự cuộn về 0 khi PUSH.
    <Page className="page" resetScroll={false} style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(72px + var(--safe-bottom))' }}>
      <HomeScrollRestoration ready={scrollReady} />
      <PullToRefresh onRefresh={refreshAll} />
      <HomeBlockErrorSuppressed.Provider value={pageDown}>
        <HomeQuickAddProvider>
          {homeRenderOrder(kind, settling).map((id) => {
            // Không có gì để khuyến mãi thì không vẽ vỏ khối: vỏ rỗng vẫn mang lề `BLOCK_GAP`.
            if (id === 'promo' && shelves.promo === null) return null;
            // Tên khối ghi lại biến thể đang vẽ (giữ tên cũ của ba khối đã gộp để số đo trước và sau so được với nhau).
            const name = id === 'context' ? homeContextBlockName(contextVariant) : id === 'promo' ? shelves.promo : id;
            return (
              <Fragment key={id}>
                <div data-home-block={name} style={shellStyle(id)}>
                  {blocks[id]}
                </div>
                {(pageDown || belowState.failed) && id === 'search' && (
                  <div data-home-block="pageError">
                    <PageErrorStrip
                      error={pageDown ? shelves.bestSellerQuery.error : belowState.error}
                      watchRetry={pageDown}
                      onRetry={refreshAll}
                    />
                  </div>
                )}
              </Fragment>
            );
          })}
        </HomeQuickAddProvider>
      </HomeBlockErrorSuppressed.Provider>
    </Page>
  );
}

// "Đang tải lại" đọc từ bộ đếm của React Query tại chính khối, không qua `isFetching` của query ở HomePage: đọc ở trang thì mỗi nhịp poll
// (isFetching đổi, dữ liệu không đổi) dựng lại cả Trang chủ.
const FlashSaleBlock = memo(function FlashSaleBlock(props: Omit<FlashSaleProps, 'retrying'>) {
  const retrying = useIsFetching({ queryKey: ['flash-sales', 'active'] }) > 0;
  return <FlashSale {...props} retrying={retrying} />;
});

const BestSellerBlock = memo(function BestSellerBlock(props: Omit<ComponentProps<typeof HomeBestSellerRail>, 'retrying'>) {
  const retrying = useIsFetching({ queryKey: homeBestSellerQuery.queryKey }) > 0;
  return <HomeBestSellerRail {...props} retrying={retrying} />;
});

function PageErrorStrip({ error, watchRetry, onRetry }: { error: unknown; watchRetry: boolean; onRetry: () => unknown }) {
  const fetching = useIsFetching({ queryKey: homeBestSellerQuery.queryKey }) > 0;
  return <HomePageError error={error} retrying={watchRetry && fetching} onRetry={onRetry} />;
}

// Header dính đầu trang khi cuộn (đứng thẳng dưới vùng an toàn); phải là con trực tiếp của trang cuộn nên áp lên chính khối bọc, không phải bên trong.
// `top` của phần tử dính đo từ mép nội dung của vùng cuộn, mà `.page` đã đệm sẵn `--safe-top`: đặt thêm `top: var(--safe-top)` cộng đôi vùng an toàn,
// header bị đẩy xuống 2× ngay cả khi chưa cuộn và che phần đầu khối kế tiếp (máy có tai thỏ, safe-top 47px che 31px thẻ "Việc cần làm").
const STICKY_HEADER: CSSProperties = { position: 'sticky', top: 0, zIndex: 20, background: 'var(--color-bg-canvas)' };

// Khoảng cách giữa khối đặt ở vỏ khối (CS-05), khối con không tự đặt đệm trên/dưới. Khối rỗng (không dữ liệu) có lề sập qua nên không để lại khoảng trống.
const BLOCK_GAP: CSSProperties = { marginTop: 'var(--space-block)' };
// Dải ngữ cảnh luôn cao đúng chừng này dù dữ liệu về muộn hay đổi biến thể: vỏ giữ chỗ cả khi nội dung bên trong rỗng.
const CONTEXT_SHELL: CSSProperties = { ...BLOCK_GAP, minHeight: HOME_CONTEXT_HEIGHT };

function shellStyle(id: HomeRenderBlock): CSSProperties | undefined {
  return id === 'search' ? STICKY_HEADER : id === 'settling' ? undefined : id === 'context' ? CONTEXT_SHELL : BLOCK_GAP;
}
