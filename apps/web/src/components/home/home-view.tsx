'use client';

import { Fragment, useLayoutEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryDTO, PageResponse, ProductCard } from '@tubutree/app-core/api/catalog';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';
import { unreadNotificationCountQuery } from '@tubutree/app-core/queries/account';
import { categoriesQuery } from '@tubutree/app-core/queries/catalog';
import { flashUpcomingQuery } from '@tubutree/app-core/queries/flash-sale';
import { homeKeptOrder, homeRenderOrder, type HomeRenderBlock } from '@tubutree/app-core/home-layout';
import { categoryEntries } from '@/lib/browse-categories';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase, useAuthRestoring } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { armHomeFeed, disarmHomeFeed } from '@/lib/home-feed';
import { HomeRestoreHintContext } from '@/lib/home-restore-context';
import type { HomeRestoreHint } from '@/lib/home-restore-hint';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { HubLayout } from '@/components/layouts/hub-layout';
import { PURCHASED_RAIL_LIMIT, PurchasedRail } from '@/components/reorder/purchased-rail';
import { usePurchasedItems } from '@/components/reorder/use-purchased-items';
import { BestSellerRail } from './best-seller-rail';
import { BrandJourney } from './brand-journey';
import { CategoryRow } from './category-row';
import { CommunityPreview } from './community-preview';
import { FlashSale } from './flash-sale';
import { refreshHomeQueries } from './home-blocks';
import { HomeBlockErrorSuppressed } from './home-block-error';
import { HomeHeader } from './home-header';
import { HomePageError } from './home-page-error';
import { MemberCard, MemberCardSkeleton, MemberCardUnavailable } from './member-card';
import { NewCustomerGift } from './new-customer-gift';
import { ShortcutGrid } from './shortcut-grid';
import { SuggestFeed } from './suggest-feed';
import { TodoStrip, useHomeTodoQueries } from './todo-strip';
import { HomeSettlingSkeleton } from './home-settling';
import { useHomeSettling, useStartedAsNew } from './use-home-settling';
import { useHomeCustomerKind } from './use-home-customer-kind';
import { useHomeShelves } from './use-home-shelves';

/** Phần công khai server đã tải cho trang ISR: có trong HTML đầu, React Query tiếp quản sau hydrate. */
export interface HomeInitial {
  bestSellers?: PageResponse<ProductCard>;
  /** Trang 1 của lưới gợi ý (chip "Tất cả"), xếp theo `suggestSeed`. */
  suggest?: PageResponse<ProductCard>;
  /** Hạt giống ngày VN lúc dựng trang: client dùng lại đúng hạt giống này để dữ liệu dựng sẵn khớp khoá và lưới không đổi thứ tự sau hydrate. */
  suggestSeed?: string;
  categories?: CategoryDTO[];
  brands?: { brand: string; count: number; slug?: string | null }[];
  /** Cấu hình công khai: khối "Quà khách mới" của khách vãng lai có ngay trong HTML server (không hiện sau hydrate làm Danh mục nhảy). */
  publicConfig?: PublicConfig;
  /** Suất Giờ vàng đang chạy lúc dựng trang: có trong HTML đầu nên khối không chen vào sau hydrate làm cả trang nhảy. */
  flash?: FlashSaleActiveItem[];
}

const STALE = 60_000;
const withInitial = <T,>(data: T | undefined) => (data !== undefined ? { initialData: data, staleTime: STALE } : {});

/**
 * Trang chủ web, cùng thứ tự khối và hành vi với pages/home.tsx của Mini App (màn đầu gọn, món hàng lên đầu). Ô tìm dính đầu trang. Khách cũ:
 * thẻ thành viên một dòng (Điểm danh) → Việc cần làm → một hàng lối tắt → Mua lại → Giờ vàng → Danh mục một hàng → Hành trình nguyên liệu →
 * Cộng đồng → MỘT lưới gợi ý cuộn vô tận. Khách mới/vãng lai: dải "Quà khách mới" thay thẻ thành viên, không có Mua lại, Giờ vàng và Bán chạy
 * đứng trước Danh mục. Từ md thẻ thành viên và Việc cần làm nằm cạnh nhau, các hàng dùng hết bề ngang. Thứ tự khối ở app-core
 * (`homeBlockOrder`). Khối lỗi tải hiện thông báo gọn + "Thử lại" ngay tại chỗ, độc lập từng khối; Bán chạy lỗi hẳn thì một dải lỗi cấp trang.
 */
export default function HomeView({ initial = {}, restoreHint = null }: { initial?: HomeInitial; /** Bản dựng sẵn cho khách đã có cookie phiên: HTML đầu mang khung chờ của loại khách này. */ restoreHint?: HomeRestoreHint | null }) {
  return (
    <HomeRestoreHintContext.Provider value={restoreHint}>
      <HomeViewBody initial={initial} />
    </HomeRestoreHintContext.Provider>
  );
}

function HomeViewBody({ initial }: { initial: HomeInitial }) {
  const qc = useQueryClient();
  const router = useRouter();
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

  // Chuông ở đây dùng chung queryKey ['notifications', 'unread'] với trang Thông báo và chuông thanh đầu: chỉ đếm, không tải danh sách tin.
  const unreadCount = useQuery({ ...unreadNotificationCountQuery(coreHttp), enabled: authed }).data?.count ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới. Trong lúc tải dùng loại đã nhớ
  // của tài khoản này để thứ tự khối không đổi sau khung hình đầu (useHomeCustomerKind).
  const purchasedRaw = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const resolvedKind = useHomeCustomerKind(authed, userId, purchasedRaw, restoring || unavailable);
  // Phiên lỗi mà máy chưa nhớ loại khách: không còn gì để chờ, dùng bố cục khách mới mặc định (Mini App cũng rơi về khách mới khi phiên lỗi).
  const kind = unavailable && resolvedKind === 'unknown' ? 'new' : resolvedKind;
  // Khung hình đầu là khách mới (HTML server): nội dung đã dựng đó ở lại khi sau đó mới biết còn phải chờ loại khách.
  const startedNew = useStartedAsNew(kind);

  // Dữ liệu chung của các kệ hàng (Giờ vàng, Mua lại, Bán chạy nhất): cùng khoá query với khối nên không thêm request, chống trùng ở một chỗ.
  const shelves = useHomeShelves(kind, { flash: initial.flash, bestSellers: initial.bestSellers });
  const categories = useQuery({ ...categoriesQuery(coreHttp), staleTime: STALE, retry: false, ...(initial.categories ? { initialData: initial.categories } : {}) });

  // Lần mở đầu chưa biết loại khách: các khối dưới thẻ thành viên chờ dữ liệu quyết định hình dạng của chúng rồi hiện cùng lúc, nên tải sớm các
  // query mà khối nào cũng sẽ dùng (cùng khoá, không thêm request).
  const upcoming = useQuery({ ...flashUpcomingQuery(coreHttp), enabled: phase !== 'loading', staleTime: 30_000 });
  const todo = useHomeTodoQueries();
  const settling = useHomeSettling(
    kind,
    todo.loading || shelves.flashQuery.isLoading || upcoming.isLoading || categories.isLoading,
    unavailable,
  );
  const entries = useMemo(() => categoryEntries(categories.data), [categories.data]);
  // API sập hẳn: kệ Bán chạy nhất (mọi loại khách đều thấy) lỗi và chưa có gì để hiện → một dải lỗi cấp trang thay cho từng thẻ lỗi.
  const pageDown = shelves.bestSellerQuery.isError && shelves.bestSellerQuery.data === undefined;

  const blocks: Record<HomeRenderBlock, ReactNode> = {
    settling: <HomeSettlingSkeleton categoryCells={categories.data ? entries.length + 1 : undefined} />,
    search: <HomeHeader unreadCount={unreadCount} />,
    member:
      kind === 'returning' && unavailable ? (
        <MemberCardUnavailable onRetry={() => void retrySession()} />
      ) : kind === 'unknown' || (kind === 'returning' && restoring) ? (
        <MemberCardSkeleton />
      ) : kind === 'returning' ? (
        <MemberCard />
      ) : null,
    todo: <TodoStrip restoring={restoring} />,
    // Khách cũ không bao giờ thấy khối này nên không gọi API ưu đãi khách mới.
    welcome: kind === 'new' ? <NewCustomerGift initialConfig={initial.publicConfig} /> : null,
    // P11 (chiến dịch) và P15 (combo) nối dữ liệu; tới lúc đó hai khối rỗng và không giữ chỗ.
    banner: null,
    combos: null,
    shortcuts: <ShortcutGrid />,
    purchased: <PurchasedRail source="home_rail" restoring={restoring} exclude={shelves.flashSlugs} />,
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
        entries={entries}
        isLoading={categories.isLoading}
        onSelect={(e) =>
          router.push(browseHref({ ...EMPTY_SEARCH_STATE, ...(e.kind === 'category' ? { category: e.key } : { segment: e.key }) }))
        }
        onSeeAll={() => router.push(browseHref(EMPTY_SEARCH_STATE))}
      />
    ),
    bestSellers: (
      <BestSellerRail
        items={shelves.bestSellers}
        ranks={shelves.bestSellerRanks}
        loading={shelves.bestSellerQuery.isLoading}
        error={shelves.bestSellerQuery.error}
        onRetry={shelves.bestSellerQuery.refetch}
        retrying={shelves.bestSellerQuery.isFetching}
      />
    ),
    journey: <BrandJourney initialBrands={initial.brands} />,
    community: <CommunityPreview />,
    suggest: <SuggestFeed initial={initial.suggest} seed={initial.suggestSeed} categories={categories.data ?? []} exclude={shelves.seen} />,
  };

  // Giữ nội dung đã dựng cả khi hẹn giờ đã nhả khung chờ mà loại khách vẫn "chưa biết" (mạng chậm): bố cục "chưa biết" bỏ Bán chạy và dải quà,
  // tới lúc biết là khách mới sẽ dựng lại, nội dung đã vẽ biến mất rồi hiện lại.
  const order = startedNew && (settling || kind === 'unknown') ? homeKeptOrder(kind) : homeRenderOrder(kind, settling);
  const wrap = (id: HomeRenderBlock) => (
    <div key={id} data-home-block={id} className={id === 'search' ? STICKY_SEARCH : undefined} style={id === 'search' || id === 'settling' ? undefined : BLOCK_GAP}>
      {blocks[id]}
    </div>
  );
  // Ô tìm (dính) đứng ngoài lưới: nó phải là con trực tiếp của trang thì `sticky` mới bám theo cuộn.
  const head: readonly HomeRenderBlock[] = order.filter((id) => id === 'search');
  // Máy tính (HubLayout): thẻ thành viên hoặc dải quà cùng Việc cần làm ở `aside`, banner bên trái nó, mọi khối còn lại bên dưới. Điện thoại giữ đúng thứ tự Mini.
  const asideIds: readonly HomeRenderBlock[] = order.filter((id) => id === 'member' || id === 'welcome' || id === 'todo');
  const hasBanner = order.includes('banner') && blocks.banner != null;
  const rest = order.filter((id) => !head.includes(id) && !asideIds.includes(id) && !(hasBanner && id === 'banner'));
  const body =
    asideIds.length === 0 ? (
      rest.map(wrap)
    ) : (
      <HubLayout
        // Banner rỗng thì không vẽ khung (không chừa cột trống); khối vẫn đứng đầu `rest` đúng thứ tự.
        banner={hasBanner ? wrap('banner') : undefined}
        aside={
          // Từ md hai khối đứng cạnh nhau để dùng hết bề ngang; khối rỗng tự ẩn khỏi hàng.
          <div className="md:flex md:gap-4 md:[&>div:empty]:hidden md:[&>div]:min-w-0 md:[&>div]:flex-1">{asideIds.map(wrap)}</div>
        }
      >
        {rest.map(wrap)}
      </HubLayout>
    );

  return (
    <HomeBlockErrorSuppressed.Provider value={pageDown}>
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
    </HomeBlockErrorSuppressed.Provider>
  );
}

// Header 56px dính đầu trang khi cuộn ở điện thoại; từ md thanh đầu website đã có ô tìm nên trả về bình thường.
const STICKY_SEARCH = 'sticky top-0 z-20 -mx-4 bg-[var(--color-bg-canvas)] px-4 md:static md:mx-0 md:bg-transparent md:px-0';

// Khoảng cách giữa các khối đặt ở vỏ khối (CS-05), khối con không tự đặt đệm trên/dưới. Khối rỗng (không dữ liệu) có lề sập qua nên không để lại khoảng trống.
const BLOCK_GAP: CSSProperties = { marginTop: 'var(--space-block)' };
