'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { CategoryDTO, PageResponse, ProductCard } from '@tubutree/app-core/api/catalog';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { notificationsQuery } from '@tubutree/app-core/queries/account';
import { categoriesQuery } from '@tubutree/app-core/queries/catalog';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { categoryEntries } from '@/lib/browse-categories';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase, useAuthRestoring } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { homeText } from '@/lib/home-text';
import { HomeRestoreHintContext } from '@/lib/home-restore-context';
import type { HomeRestoreHint } from '@/lib/home-restore-hint';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { PURCHASED_RAIL_LIMIT, PurchasedRail } from '@/components/reorder/purchased-rail';
import { usePurchasedItems } from '@/components/reorder/use-purchased-items';
import { BestSellerRail } from './best-seller-rail';
import { BrandJourney } from './brand-journey';
import { CategoryRow } from './category-row';
import { CommunityPreview } from './community-preview';
import { FlashSale, UpcomingFlashSales } from './flash-sale';
import { homeBlockOrder, refreshHomeQueries, type HomeBlockId } from './home-blocks';
import { HomeBlockErrorSuppressed } from './home-block-error';
import { HomeHeader } from './home-header';
import { HomePageError } from './home-page-error';
import { MemberCard, MemberCardSkeleton } from './member-card';
import { NewCustomerGift } from './new-customer-gift';
import { ShortcutGrid } from './shortcut-grid';
import { SuggestFeed } from './suggest-feed';
import { TodoStrip } from './todo-strip';
import { useBlockQuery } from './use-block-query';
import { useHomeCustomerKind } from './use-home-customer-kind';

/** Phần công khai server đã tải cho trang ISR: có trong HTML đầu, React Query tiếp quản sau hydrate. */
export interface HomeInitial {
  bestSellers?: PageResponse<ProductCard>;
  /** Trang 1 của lưới gợi ý (nguồn mặc định). */
  suggest?: PageResponse<ProductCard>;
  categories?: CategoryDTO[];
  brands?: { brand: string; count: number; slug?: string | null }[];
  /** Cấu hình công khai: khối "Quà khách mới" của khách vãng lai có ngay trong HTML server (không hiện sau hydrate làm Danh mục nhảy). */
  publicConfig?: PublicConfig;
}

const STALE = 60_000;
const withInitial = <T,>(data: T | undefined) => (data !== undefined ? { initialData: data, staleTime: STALE } : {});

/**
 * Trang chủ web, cùng thứ tự khối và hành vi với pages/home.tsx của Mini App (phương án A, 9 khối). Khách cũ: thẻ thành viên (Điểm danh,
 * Đổi quà) → Việc cần làm → 8 lối tắt → Mua lại → Giờ vàng → Danh mục một hàng → Hành trình nguyên liệu → Cộng đồng → MỘT lưới gợi ý
 * cuộn vô tận. Khách mới/vãng lai: "Quà khách mới" thay thẻ thành viên, không có Mua lại, thêm kệ Bán chạy. Thứ tự khối ở app-core
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
  const authed = useAuthPhase() === 'authenticated';
  const restoring = useAuthRestoring();
  const userId = useAuth().user?.id;

  // Chuông ở đây dùng chung queryKey ['notifications'] với trang Thông báo.
  const unreadCount = useQuery({ ...notificationsQuery(coreHttp), enabled: authed }).data?.filter((n) => n.status !== 'READ').length ?? 0;

  // Cùng query key với PurchasedRail → không thêm request; chỉ để biết khách cũ hay mới. Trong lúc tải dùng loại đã nhớ
  // của tài khoản này để thứ tự khối không đổi sau khung hình đầu (useHomeCustomerKind).
  const purchasedRaw = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const kind = useHomeCustomerKind(authed, userId, purchasedRaw, restoring);

  // Cùng khoá với kệ Bán chạy của khách mới: ở đây chỉ để biết API sập hẳn (dải lỗi cấp trang), không thêm request.
  const bestSellers = useBlockQuery(useQuery({ ...homeBestSellerQuery(coreHttp), ...withInitial(initial.bestSellers), enabled: kind === 'new' }));
  const categories = useQuery({ ...categoriesQuery(coreHttp), staleTime: STALE, retry: false, ...(initial.categories ? { initialData: initial.categories } : {}) });
  const entries = useMemo(() => categoryEntries(categories.data), [categories.data]);
  // Chỉ tính khi khách đang THẤY kệ Bán chạy (khách mới); khách cũ không nhận dải lỗi vì kệ họ không thấy.
  const pageDown = kind === 'new' && bestSellers.isError && bestSellers.data === undefined;

  const blocks: Record<HomeBlockId, ReactNode> = {
    search: <SearchRow />,
    member: kind === 'unknown' || (kind === 'returning' && restoring) ? <MemberCardSkeleton /> : kind === 'returning' ? <MemberCard /> : null,
    todo: <TodoStrip restoring={restoring} />,
    // Khách cũ không bao giờ thấy khối này nên không gọi API ưu đãi khách mới.
    welcome: kind === 'new' ? <NewCustomerGift initialConfig={initial.publicConfig} /> : null,
    shortcuts: <ShortcutGrid />,
    purchased: <PurchasedRail restoring={restoring} />,
    flash: (
      <>
        <FlashSale />
        <UpcomingFlashSales />
      </>
    ),
    categories: (
      <CategoryRow
        entries={entries}
        isLoading={categories.isLoading}
        onSelect={(e) =>
          router.push(browseHref({ ...EMPTY_SEARCH_STATE, ...(e.kind === 'category' ? { category: e.key } : { segment: e.key }) }))
        }
      />
    ),
    bestSellers: <BestSellerRail initial={initial.bestSellers} />,
    journey: <BrandJourney initialBrands={initial.brands} />,
    community: <CommunityPreview />,
    suggest: <SuggestFeed initial={initial.suggest} />,
  };

  return (
    <HomeBlockErrorSuppressed.Provider value={pageDown}>
      <HomeHeader unreadCount={unreadCount} />
      {homeBlockOrder(kind).map((id) => (
        <Fragment key={id}>
          <div data-home-block={id}>{blocks[id]}</div>
          {pageDown && id === 'search' && (
            <div data-home-block="pageError">
              <HomePageError error={bestSellers.error} retrying={bestSellers.isFetching} onRetry={() => refreshHomeQueries(qc)} />
            </div>
          )}
        </Fragment>
      ))}
    </HomeBlockErrorSuppressed.Provider>
  );
}

/**
 * Ô tìm ở Trang chủ chỉ là vỏ: mở thẳng bàn phím ở ô thật bên /san-pham (?focus=search). Chỉ ở điện thoại: từ md thanh đầu website
 * đã có ô tìm và chuông thông báo (HeaderBell), chuông điện thoại nằm ở HomeHeader.
 */
function SearchRow() {
  return (
    <div className="flex items-center gap-2 pb-3 md:hidden">
      <Link
        href="/san-pham?focus=search"
        aria-label={homeText.searchPlaceholder}
        className="flex min-h-[46px] min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--color-border-subtle)] bg-stone-0 px-4 py-[11px] shadow-card transition"
      >
        <Search className="h-4 w-4 flex-none text-stone-600" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm text-stone-600">{homeText.searchPlaceholder}</span>
      </Link>
    </div>
  );
}
