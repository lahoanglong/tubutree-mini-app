'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useWindowScrollRestore } from '@/lib/use-window-scroll-restore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BestSellersPage } from '@tubutree/app-core/api/browse';
import type { BundleDTO } from '@tubutree/app-core/api/bundle';
import type { CategoryDTO, PageResponse, ProductCard } from '@tubutree/app-core/api/catalog';
import type { CampaignBanner } from '@tubutree/app-core/api/campaign';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';
import { meSummaryQuery } from '@tubutree/app-core/api/me-summary';
import { categoriesQuery } from '@tubutree/app-core/queries/catalog';
import { flashUpcomingQuery } from '@tubutree/app-core/queries/flash-sale';
import { HOME_CONTEXT_HEIGHT, homeContextBlockName, homeInterleaveCard, homeKeptOrder, homeRenderOrder, writeFlashHint, type HomeRenderBlock } from '@tubutree/app-core/home-layout';
import { vnDateSeed } from '@tubutree/app-core/home-suggest';
import { serverNow } from '@tubutree/app-core/server-clock';
import { categoryEntries } from '@/lib/browse-categories';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase, useAuthRestoring } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { armHomeFeed, disarmHomeFeed } from '@/lib/home-feed';
import { HomeRestoreHintContext } from '@/lib/home-restore-context';
import { browserStorage } from '@/lib/recently-viewed';
import type { HomeRestoreHint } from '@/lib/home-restore-hint';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { HomeBanner } from '@/components/campaign/home-banner';
import { useHomeBanners } from '@/components/campaign/use-home-banners';
import { HubLayout } from '@/components/layouts/hub-layout';
import { PURCHASED_RAIL_LIMIT, PurchasedRail } from '@/components/reorder/purchased-rail';
import { usePurchasedItems } from '@/components/reorder/use-purchased-items';
import { BEST_SELLER_LEAD_PRIORITY, BestSellerRail } from './best-seller-rail';
import { CategoryRow } from './category-row';
import { CommunityPreview } from './community-preview';
import { HomeContextStrip, useHomeContextVariant } from './context-strip';
import { HomeQuickAddProvider } from './home-quick-add';
import { HomeCombos } from './home-combos';
import { FlashSale } from './flash-sale';
import { refreshHomeQueries } from './home-blocks';
import { HomeBlockErrorSuppressed } from './home-block-error';
import { HomeHeader } from './home-header';
import { HomePageError } from './home-page-error';
import { HomeEditorialHero } from './home-editorial-hero';
import { HomeStoryReel } from './home-story-reel';
import { ShortcutGrid } from './shortcut-grid';
import { SuggestFeed } from './suggest-feed';
import { useHomeTodoQueries } from './todo-strip';
import { HomeSettlingSkeleton } from './home-settling';
import { useHomeSettling, useStartedAsNew } from './use-home-settling';
import { useHomeCustomerKind } from './use-home-customer-kind';
import { useHomeShelves } from './use-home-shelves';
import { HomeQuizCard } from '@/components/game/home-quiz-card';
import { HomeBlockTracker } from '@/components/analytics/home-block-tracker';

/** Phần công khai server đã tải cho trang ISR: có trong HTML đầu, React Query tiếp quản sau hydrate. */
export interface HomeInitial {
  bestSellers?: BestSellersPage;
  /** Trang 1 của lưới gợi ý (chip "Tất cả"), xếp theo `suggestSeed`. */
  suggest?: PageResponse<ProductCard>;
  /** Hạt giống ngày VN lúc dựng trang: client dùng lại đúng hạt giống này để dữ liệu dựng sẵn khớp khoá và lưới không đổi thứ tự sau hydrate. */
  suggestSeed?: string;
  categories?: CategoryDTO[];
  /** Không còn khối nào dùng (Hành trình nguyên liệu đã rời Trang chủ); giữ kiểu để `loadHomeInitial` vẫn trả được. */
  brands?: { brand: string; count: number; slug?: string | null }[];
  /** Cấu hình công khai: dải Quà khách mới của khách vãng lai có ngay trong HTML server, cao đúng 64px (không hiện sau hydrate làm Danh mục nhảy). */
  publicConfig?: PublicConfig;
  /** Suất Giờ vàng đang chạy lúc dựng trang: có trong HTML đầu nên khối không chen vào sau hydrate làm cả trang nhảy. */
  flash?: FlashSaleActiveItem[];
  /** Banner chiến dịch đang chạy lúc dựng trang: có trong HTML đầu nên khối không chen vào sau hydrate. Rỗng nghĩa là server đã hỏi và không có. */
  campaigns?: CampaignBanner[];
  /** Combo toàn sàn đang chạy lúc dựng trang: có trong HTML đầu nên kệ không chen vào sau hydrate, và Bán chạy nhất bỏ món của combo ngay trong HTML. Rỗng nghĩa là server đã hỏi và không có. */
  combos?: BundleDTO[];
  /** Lúc máy chủ lấy `combos` (ms): để hydrate hỏi lại ngay khi HTML ISR đã cũ hơn hạn tươi. */
  combosAt?: number;
}

const STALE = 60_000;
const withInitial = <T,>(data: T | undefined) => (data !== undefined ? { initialData: data, staleTime: STALE } : {});

/**
 * Trang chủ web, cùng thứ tự khối và hành vi với pages/home.tsx của Mini App (màn đầu gọn, tối đa 9 khối, thẻ sản phẩm lộ trong màn đầu). Ô tìm dính đầu trang, rồi MỘT dải
 * ngữ cảnh cao 64px (Việc cần làm một dòng, Quà khách mới, thẻ thành viên gọn hay khung chờ) → Danh mục một hàng → Bán chạy nhất → MỘT ô khuyến mãi (Giờ vàng đang chạy,
 * banner chiến dịch hay combo, tự ẩn khi không có gì) → Mua lại (khách cũ) → hai thẻ chính + bốn ô phụ → dải Story → MỘT lưới gợi ý cuộn vô tận, trong đó Chẩn đoán tổ ấm hoặc
 * Cộng đồng chen sau 8 thẻ đầu (luân phiên theo ngày). Từ md khối giới thiệu mặc định đứng trên dải ngữ cảnh (`HubLayout` hero). Thứ tự khối ở app-core (`homeBlockOrder`).
 * Khối lỗi tải hiện thông báo gọn + "Thử lại" ngay tại chỗ, độc lập từng khối; Bán chạy lỗi hẳn thì một dải lỗi cấp trang.
 */
export default function HomeView({ initial = {}, restoreHint = null }: { initial?: HomeInitial; /** Bản dựng sẵn cho khách đã có cookie phiên: HTML đầu mang khung chờ của loại khách này. */ restoreHint?: HomeRestoreHint | null }) {
  return (
    <HomeRestoreHintContext.Provider value={restoreHint}>
      <HomeViewBody initial={initial} />
      <HomeBlockTracker />
    </HomeRestoreHintContext.Provider>
  );
}

function HomeViewBody({ initial }: { initial: HomeInitial }) {
  const qc = useQueryClient();
  const router = useRouter();
  useWindowScrollRestore('home');
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const restoring = useAuthRestoring();
  const { retrySession, user } = useAuth();
  const userId = user?.id;
  // Layout effect chạy sau effect layout của con nhưng TRƯỚC mọi effect thường, nơi query của các khối con gửi request đầu; khác với bật
  // trong render, bị bỏ dở giữa chừng thì không để bộ chặn sót lại ở trang khác.
  useLayoutEffect(() => {
    armHomeFeed(userId);
  }, [userId]);
  useLayoutEffect(() => disarmHomeFeed, []);
  // Cờ phiên còn mà mất mạng hay API tạm lỗi lúc khôi phục: khách KHÔNG phải khách vãng lai, giữ loại khách đã nhớ để trang không tụt về bố cục khách mới.
  const unavailable = phase === 'unavailable';

  // Chuông ở đây dùng chung /me/summary với Cá nhân, thanh đáy và chuông thanh đầu: chỉ đếm, không tải danh sách tin.
  const unreadCount = useQuery({ ...meSummaryQuery(coreHttp), select: (s) => s.unreadNotifications, enabled: authed }).data ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới. Trong lúc tải dùng loại đã nhớ
  // của tài khoản này để thứ tự khối không đổi sau khung hình đầu (useHomeCustomerKind).
  const purchasedRaw = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const resolvedKind = useHomeCustomerKind(authed, userId, purchasedRaw, restoring || unavailable);
  // Phiên lỗi mà máy chưa nhớ loại khách: không còn gì để chờ, dùng bố cục khách mới mặc định (Mini App cũng rơi về khách mới khi phiên lỗi).
  const kind = unavailable && resolvedKind === 'unknown' ? 'new' : resolvedKind;
  // Khung hình đầu là khách mới (HTML server): nội dung đã dựng đó ở lại khi sau đó mới biết còn phải chờ loại khách.
  const startedNew = useStartedAsNew(kind);

  // Cùng query key với khối banner (không thêm request): ô khuyến mãi chọn giữa Giờ vàng, banner và combo, và khung chờ chung phải chờ cả banner vì khối thật chưa mount trong lúc giữ khung chờ.
  const banners = useHomeBanners(kind, initial.campaigns);
  // Dữ liệu chung của các kệ hàng (Giờ vàng, Mua lại, Bán chạy nhất, combo): cùng khoá query với khối nên không thêm request, chống trùng ở một chỗ.
  const shelves = useHomeShelves(
    kind,
    { flash: initial.flash, bestSellers: initial.bestSellers, combos: initial.combos, combosAt: initial.combosAt },
    { slides: banners.slides.length, pending: banners.loading, remembered: banners.hinted },
  );
  const categories = useQuery({ ...categoriesQuery(coreHttp), staleTime: STALE, retry: false, ...(initial.categories ? { initialData: initial.categories } : {}) });

  // Lần mở đầu chưa biết loại khách: các khối dưới dải ngữ cảnh chờ dữ liệu quyết định hình dạng của chúng rồi hiện cùng lúc, nên tải sớm các
  // query mà khối nào cũng sẽ dùng (cùng khoá, không thêm request).
  const upcoming = useQuery({ ...flashUpcomingQuery(coreHttp), enabled: phase !== 'loading', staleTime: 30_000 });
  const todo = useHomeTodoQueries();
  const settling = useHomeSettling(
    kind,
    todo.loading || shelves.flashQuery.isLoading || upcoming.isLoading || categories.isLoading || banners.loading,
    unavailable,
  );
  const variant = useHomeContextVariant({ kind, restoring, todo });
  const entries = useMemo(() => categoryEntries(categories.data), [categories.data]);
  // API sập hẳn: kệ Bán chạy nhất (mọi loại khách đều thấy) lỗi và chưa có gì để hiện → một dải lỗi cấp trang thay cho từng thẻ lỗi.
  const pageDown = shelves.bestSellerQuery.isError && shelves.bestSellerQuery.data === undefined;
  // Còn suất Giờ vàng nào có món (đang chạy hay sắp tới) không: chưa biết (đang tải hay lỗi) thì `undefined`, lối vào Giờ vàng giữ nguyên thay vì chớp rồi mất.
  const flashKnown = !shelves.flashQuery.isLoading && !shelves.flashQuery.isError && !upcoming.isPending && !upcoming.isError;
  const flashLive = flashKnown ? shelves.flash.length > 0 || (upcoming.data?.length ?? 0) > 0 : undefined;
  // Khối Giờ vàng chỉ gắn khi là ô khuyến mãi được chọn nên không tự ghi "không có" được: không ghi thì lần mở sau giữ khung chờ cho một Giờ vàng đã hết.
  const flashSettledEmpty = !shelves.flashQuery.isLoading && !shelves.flashQuery.isError && shelves.flash.length === 0;
  useEffect(() => {
    if (flashSettledEmpty) writeFlashHint(browserStorage(), false);
  }, [flashSettledEmpty]);
  // Chốt một lần mỗi lần mở, cùng hạt giống mà lưới Gợi ý dùng: thẻ chen không đổi giữa chừng khi qua nửa đêm.
  const [daySeed] = useState(() => initial.suggestSeed ?? vnDateSeed(serverNow()));

  // HTML đầu đã là bố cục khách mới: giữ nguyên thứ tự đó suốt lượt xem này, cả khi hẹn giờ đã nhả khung chờ mà loại khách vẫn "chưa biết"
  // (mạng chậm) lẫn khi đã biết là khách cũ (Mua lại chen ngay trên lưới Gợi ý, xem `homeKeptOrder`), để nội dung đã vẽ không biến mất hay bị đẩy xuống.
  const order = startedNew ? homeKeptOrder(kind) : homeRenderOrder(kind, settling);
  const promo = shelves.promo;

  const blocks: Record<HomeRenderBlock, ReactNode> = {
    settling: <HomeSettlingSkeleton categoryCells={categories.data ? entries.length + 1 : undefined} />,
    search: <HomeHeader unreadCount={unreadCount} />,
    context: <HomeContextStrip variant={variant} kind={kind} unavailable={unavailable} onRetry={() => void retrySession()} todo={todo} initialConfig={initial.publicConfig} />,
    // Không có ô khuyến mãi nào thì không vẽ vỏ khối (xem `wrap`); banner không chiếm hết 12 cột từ lg để ảnh 5:2 không cao quá màn.
    promo:
      promo === 'flash' ? (
        <FlashSale
          items={shelves.flash}
          loading={shelves.flashQuery.isLoading}
          error={shelves.flashQuery.error}
          onRetry={shelves.flashQuery.refetch}
          retrying={shelves.flashQuery.isFetching}
          onExpire={shelves.onFlashEnd}
          guardEndAts={shelves.flashQuery.data?.map((it) => it.endAt)}
        />
      ) : promo === 'banner' ? (
        <div className="lg:w-2/3">
          <HomeBanner slides={banners.slides} />
        </div>
      ) : promo === 'combos' ? (
        <HomeCombos views={shelves.combos} />
      ) : null,
    shortcuts: <ShortcutGrid initialConfig={initial.publicConfig} flashLive={flashLive} />,
    stories: <HomeStoryReel initialBestSellers={initial.bestSellers} />,
    purchased: <PurchasedRail source="home_rail" restoring={restoring} excludeVariations={shelves.flashVariationIds} />,
    categories: (
      <CategoryRow
        entries={entries}
        isLoading={categories.isLoading}
        onSelect={(e) =>
          router.push(browseHref({ ...EMPTY_SEARCH_STATE, ...(e.kind === 'category' ? { category: e.key } : { segment: e.key }) }))
        }
        onSeeAll={() => router.push(browseHref(EMPTY_SEARCH_STATE))}
      />
    ),
    // Bán chạy nhất luôn là khối ảnh đầu tiên (header, dải ngữ cảnh và Danh mục không có ảnh sản phẩm; ô khuyến mãi và Mua lại nằm dưới nó): ảnh của kệ là LCP nên không được tải lười.
    bestSellers: (
      <BestSellerRail
        items={shelves.bestSellers}
        ranks={shelves.bestSellerRanks}
        basis={shelves.bestSellerBasis}
        loading={shelves.bestSellerQuery.isLoading}
        error={shelves.bestSellerQuery.error}
        onRetry={shelves.bestSellerQuery.refetch}
        retrying={shelves.bestSellerQuery.isFetching}
        priorityCount={BEST_SELLER_LEAD_PRIORITY}
      />
    ),
    suggest: (
      <SuggestFeed
        initial={initial.suggest}
        seed={initial.suggestSeed}
        categories={categories.data ?? []}
        exclude={shelves.seen}
        interleave={homeInterleaveCard(daySeed) === 'quiz' ? <HomeQuizCard /> : <CommunityPreview />}
      />
    ),
  };

  // Tên ghi ở `data-home-block` của dải ngữ cảnh và ô khuyến mãi là biến thể đang hiện (giữ tên cũ của các khối đã gộp để số đo trước và sau so được với nhau).
  const wrap = (id: HomeRenderBlock) => {
    if (id === 'promo' && promo === null) return null;
    const name = id === 'context' ? homeContextBlockName(variant) : id === 'promo' ? promo! : id;
    const style = id === 'search' || id === 'settling' ? undefined : id === 'context' ? CONTEXT_BLOCK : BLOCK_GAP;
    return (
      <div key={id} data-home-block={name} className={id === 'search' ? STICKY_SEARCH : undefined} style={style}>
        {blocks[id]}
      </div>
    );
  };
  // Ô tìm (dính) đứng ngoài lưới: nó phải là con trực tiếp của trang thì `sticky` mới bám theo cuộn.
  const head: readonly HomeRenderBlock[] = order.filter((id) => id === 'search');
  const rest = order.filter((id) => id !== 'search' && id !== 'context');
  // Máy tính (HubLayout): khối giới thiệu mặc định (từ md) bên trái, dải ngữ cảnh ở `aside`, mọi khối còn lại bên dưới. Điện thoại giữ đúng thứ tự Mini: banner đã nằm trong ô khuyến mãi.
  const body = (
    <HubLayout hero={<HomeEditorialHero />} aside={wrap('context')}>
      {rest.map(wrap)}
    </HubLayout>
  );

  return (
    <HomeBlockErrorSuppressed.Provider value={pageDown}>
      <HomeQuickAddProvider>
        {head.map((id) => (
          <Fragment key={id}>
            {wrap(id)}
            {pageDown && id === 'search' && (
              <div data-home-block="pageError">
                <HomePageError error={shelves.bestSellerQuery.error} retrying={shelves.bestSellerQuery.isFetching} onRetry={() => refreshHomeQueries(qc)} />
              </div>
            )}
          </Fragment>
        ))}
        {body}
      </HomeQuickAddProvider>
    </HomeBlockErrorSuppressed.Provider>
  );
}

// Header 56px dính đầu trang khi cuộn ở điện thoại; từ md thanh đầu website đã có ô tìm nên trả về bình thường.
const STICKY_SEARCH = 'tubu-bleed sticky top-0 z-20 bg-[var(--color-bg-canvas)] px-4 md:static md:bg-transparent md:px-0';

// Khoảng cách giữa các khối đặt ở vỏ khối (CS-05), khối con không tự đặt đệm trên/dưới. Khối rỗng (không dữ liệu) có lề sập qua nên không để lại khoảng trống.
const BLOCK_GAP: CSSProperties = { marginTop: 'var(--space-block)' };
// Dải ngữ cảnh luôn cao tối thiểu `HOME_CONTEXT_HEIGHT` kể cả khi nội dung bên trong chưa về hay không vẽ gì (khách vãng lai lỗi cấu hình): các khối dưới không nhảy.
const CONTEXT_BLOCK: CSSProperties = { ...BLOCK_GAP, minHeight: HOME_CONTEXT_HEIGHT };
