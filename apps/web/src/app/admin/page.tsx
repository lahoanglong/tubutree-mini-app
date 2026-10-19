'use client';

import React, { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Banknote, Check, ChevronDown, ChevronUp, Download, Recycle, Store, TreePine, Trophy } from 'lucide-react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { formatVnd } from '@/lib/shop-client';
import {
  listDealerApps,
  reviewDealerApp,
  mergeQueuePages,
  nextPageParam,
  type DealerApp,
  listUsers,
  blockUser,
  unblockUser,
  setUserRole,
  type UserRole,
  type AdminUser,
  listOrders,
  getDashboardStats,
  type DashboardStats,
  getConfig,
  createCoupon,
  listBrands,
  createBrand,
  updateBrand,
  verifyBrand,
  listBrandProducts,
  linkBrandByName,
  detachBrandProducts,
  listPromotions,
  createPromotion,
  deletePromotion,
  listDealerRewards,
  createDealerReward,
  deleteDealerReward,
  listFlashSales,
  createFlashSale,
  updateFlashSale,
  addFlashSaleItem,
  deleteFlashSale,
  deleteFlashSaleItem,
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  getContentKit,
  saveContentKit,
  listAcademyCourses,
  createAcademyCourse,
  updateAcademyCourse,
  deleteAcademyCourse,
  addAcademyLesson,
  updateAcademyLesson,
  deleteAcademyLesson,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  listReturnRequests,
  type AdminBrand,
  type ConfigRow,
  type BrandCert,
  type AdminFlashSale,
  type AdminFaq,
  type ContentKitFaq,
  type AdminCourse,
  type AdminLesson,
  type AcademyLessonContentType,
  type AdminQuickReply,
  countRecyclingAttention,
  countPancakeAttention,
  listDealerRewardClaims,
  listPayouts,
  type RecyclingFilter,
  type PancakeFilter,
  type InvoiceFilter,
  type OrderListExtra,
  orderExtraFilters,
  downloadOrdersCsv,
  downloadUsersCsv,
  getOpsAccess,
  type InboxKey,
  type StaffPermission,
  type AdminOrder,
} from '@/lib/admin-client';
import { RecyclingBadge, RecyclingPanel } from '@/components/admin/recycling-panel';
import {
  PANCAKE_ATTENTION_COUNT_KEY,
  PancakeAttentionBadge,
  PancakeAttentionPanel,
} from '@/components/admin/pancake-attention';
import { PancakeSyncBadge, PancakeSyncPanel } from '@/components/admin/pancake-sync';
import { DealerPaymentPanel } from '@/components/admin/dealer-payment-panel';
import { ClaimCampaignPanel } from '@/components/admin/claim-campaign-panel';
import { DealerCreditPanel } from '@/components/admin/dealer-credit-panel';
import { OrderStatusActions } from '@/components/admin/order-status-actions';
import { ReturnRow } from '@/components/admin/return-request-row';
import { GomdonConfigCard } from '@/components/admin/gomdon-config-card';
import { ConfigItem } from '@/components/admin/config-item';
import { LoyaltyConfigCard } from '@/components/admin/loyalty-config-card';
import { CashbackTab } from '@/components/admin/cashback-tab';
import { CustomerRefundsPendingBadge, CustomerRefundsTab } from '@/components/admin/customer-refunds-tab';
import { DealerClaimsTab } from '@/components/admin/dealer-claims-tab';
import { MerchantProductsTab } from '@/components/admin/merchant-products-tab';
import { StorefrontsTab } from '@/components/admin/storefronts-tab';
import { MerchantFulfilmentTab } from '@/components/admin/merchant-fulfilment-tab';
import { NotificationTemplatesTab } from '@/components/admin/notification-templates-tab';
import { PayoutAdminTab } from '@/components/admin/payout-admin-tab';
import { PosCreditsTab } from '@/components/admin/pos-credits-tab';
import { AccountDeletionPanel } from '@/components/admin/account-deletion-panel';
import { useConfirm } from '@/components/admin/confirm-dialog';
import { CouponList } from '@/components/admin/coupon-list';
import { InvoiceFilterChips } from '@/components/admin/invoice-filter-chips';
import { OrderExtraFilters } from '@/components/admin/order-extra-filters';
import { OrderInvoicePanel, OrderReferralPanel, OrderShippingAddress, OrderStatusHistory } from '@/components/admin/order-detail-extras';
import { DealerTierSelect } from '@/components/admin/dealer-tier-select';
import { ProductPicker, useVariationLabels } from '@/components/admin/product-picker';
import { ReviewsTab } from '@/components/admin/reviews-tab';
import type { PickedItem } from '@/components/admin/search-picker';
import { SubscriptionsTab } from '@/components/admin/subscriptions-tab';
import { UserPicker } from '@/components/admin/user-picker';
import {
  BTN_DANGER_OUTLINE,
  BTN_LINK,
  BTN_LINK_DANGER,
  BTN_LINK_MUTED,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  FIELD_CLASS,
  Field,
  INPUT_CLASS,
  ScrollRegion,
  TOUCH_H,
  ToneBadge,
} from '@/components/admin/ui';
import { AnalyticsTab } from './analytics-tab';
import { ReportsTab, reportSectionsFor } from '@/components/admin/reports-tab';
import { AdminNav, type NavGroup } from '@/components/admin/admin-nav';
import { OpsInboxTab } from '@/components/admin/ops-inbox-tab';
import { OpsHealthTab } from '@/components/admin/ops-health-tab';
import { WasteTab, type WasteSeed } from '@/components/admin/waste-tab';
import { DealerAccountsTab } from '@/components/admin/dealer-accounts-tab';
import { DealerPriceHistoryTab } from '@/components/admin/dealer-price-history-tab';
import { CommissionRatesTab } from '@/components/admin/commission-rates-tab';
import { ProductCategoriesTab } from '@/components/admin/product-categories-tab';
import { EngagementTab } from '@/components/admin/engagement-tab';
import { ExternalOrdersTab } from '@/components/admin/external-orders-tab';
import { ExternalClaimsTab } from '@/components/admin/external-claims-tab';
import { CommunityModerationTab, type CommunityView } from '@/components/admin/community-moderation-tab';
import { AttendanceTab } from '@/components/admin/attendance-tab';
import { StaffRosterTab } from '@/components/admin/staff-roster-tab';
import { ShiftApprovalTab } from '@/components/admin/shift-approval-tab';
import { PayrollAdminTab } from '@/components/admin/payroll-admin-tab';
import { UserDetailDrawer } from '@/components/admin/user-detail-drawer';
import { UsersList, USER_ROLE_LABELS } from '@/components/admin/users-list';
import { SideDrawer, useNarrowScreen } from '@/components/admin/side-drawer';
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/export-csv';
import { DEALER_APP_FILTERS, dealerAppStatusLabel } from '@/lib/dealer-applications';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { isRefundInProgress, orderPaymentStatusShort, shippingStatusLabel } from '@/lib/order-view';
import { OrderPaymentSummary } from '@/components/admin/order-payment-summary';

type Tab =
  | 'inbox'
  | 'opsHealth'
  | 'waste'
  | 'attendance'
  | 'staffRoster'
  | 'shiftApproval'
  | 'payroll'
  | 'dashboard'
  | 'dealers'
  | 'dealerClaims'
  | 'dealerAccounts'
  | 'dealerPrices'
  | 'commissionRates'
  | 'productCategories'
  | 'engagement'
  | 'community'
  | 'payouts'
  | 'customerRefunds'
  | 'orders'
  | 'externalOrders'
  | 'externalClaims'
  | 'returns'
  | 'users'
  | 'config'
  | 'coupons'
  | 'brands'
  | 'flashSales'
  | 'faqs'
  | 'contentKit'
  | 'academy'
  | 'quickReplies'
  | 'notificationTemplates'
  | 'merchantProducts'
  | 'storefronts'
  | 'merchantFulfilment'
  | 'cashback'
  | 'posCredits'
  | 'reviews'
  | 'subscriptions'
  | 'analytics'
  | 'reports';
/**
 * Mục quản trị theo nhóm việc (ADMINOPS-13): trước đây là một dải 24 tab cuộn ngang. Khoá `k` giữ nguyên để link cũ
 * (`/admin?tab=orders&pancake=attention`...) vẫn mở đúng chỗ.
 */
const NAV_GROUPS: NavGroup<Tab>[] = [
  {
    label: 'Tổng quan',
    items: [
      { k: 'inbox', label: 'Việc cần xử lý' },
      { k: 'dashboard', label: 'Tổng quan KPI' },
      { k: 'analytics', label: 'Retention & North-star' },
      { k: 'reports', label: 'Báo cáo' },
    ],
  },
  {
    label: 'Đơn hàng & giao vận',
    items: [
      { k: 'orders', label: 'Đơn hàng' },
      { k: 'externalOrders', label: 'Đơn ngoài app' },
      { k: 'externalClaims', label: 'Tích điểm đơn sàn' },
      { k: 'merchantFulfilment', label: 'Đơn đối tác & đối soát' },
    ],
  },
  {
    label: 'Hoàn tiền & đổi trả',
    items: [
      { k: 'returns', label: 'Đổi / Trả' },
      { k: 'customerRefunds', label: 'Hoàn tiền khách' },
      { k: 'cashback', label: 'Hoàn tiền sàn ngoài' },
    ],
  },
  {
    label: 'Người bán',
    items: [
      { k: 'dealers', label: 'Đại lý' },
      { k: 'dealerClaims', label: 'Thưởng đại lý' },
      { k: 'dealerAccounts', label: 'Đại lý & công nợ' },
      { k: 'dealerPrices', label: 'Lịch sử giá đại lý' },
      { k: 'commissionRates', label: 'Hoa hồng & giá sỉ' },
      { k: 'productCategories', label: 'Danh mục sản phẩm' },
      { k: 'payouts', label: 'Rút tiền CTV' },
      { k: 'merchantProducts', label: 'Duyệt SP đối tác' },
      { k: 'storefronts', label: 'Gian hàng' },
      { k: 'brands', label: 'Nhãn hàng' },
    ],
  },
  {
    label: 'Khách hàng',
    items: [
      { k: 'users', label: 'Người dùng' },
      { k: 'reviews', label: 'Đánh giá' },
      { k: 'community', label: 'Cộng đồng' },
      { k: 'subscriptions', label: 'Gói định kỳ' },
      { k: 'posCredits', label: 'Tích điểm tại quầy' },
      { k: 'waste', label: 'Đổi rác' },
    ],
  },
  {
    label: 'Khuyến mãi',
    items: [
      { k: 'coupons', label: 'Voucher' },
      { k: 'flashSales', label: 'Flash Sale' },
      { k: 'engagement', label: 'Nhiệm vụ' },
    ],
  },
  {
    label: 'Nội dung',
    items: [
      { k: 'faqs', label: 'Câu hỏi thường gặp' },
      { k: 'contentKit', label: 'Content Kit CTV' },
      { k: 'academy', label: 'Academy' },
      { k: 'quickReplies', label: 'CSKH mẫu tin nhanh' },
      { k: 'notificationTemplates', label: 'Mẫu thông báo' },
    ],
  },
  {
    label: 'Nhân sự',
    items: [
      { k: 'staffRoster', label: 'Nhân sự & quyền' },
      { k: 'shiftApproval', label: 'Duyệt ca' },
      { k: 'payroll', label: 'Lương' },
      { k: 'attendance', label: 'Chấm công' },
    ],
  },
  {
    label: 'Cấu hình & tích hợp',
    items: [
      { k: 'config', label: 'Cấu hình' },
      { k: 'opsHealth', label: 'Sức khoẻ hệ thống' },
    ],
  },
];
const TABS = NAV_GROUPS.flatMap((g) => g.items);
const DEFAULT_TAB: Tab = 'inbox';

/**
 * Mục nhân viên (STAFF) mở được theo nhóm việc — khớp các route @AllowStaff ở API (staff-permissions.matrix.spec.ts);
 * mọi nhân viên đều mở được tab Đổi rác (hàng đợi kho, màn đếm và quà chờ nhận; route /admin/waste/requests và /admin/waste/gift-redemptions mở cho STAFF, spec 16.2).
 */
const STAFF_TABS: Record<'BASE' | StaffPermission, Tab[]> = {
  BASE: ['waste'],
  CSKH: ['inbox', 'orders', 'externalOrders', 'externalClaims', 'returns', 'users', 'quickReplies', 'community'],
  KHO: ['inbox', 'orders', 'returns'],
  MARKETING: ['inbox', 'reports', 'community', 'coupons', 'flashSales', 'faqs', 'contentKit', 'academy', 'notificationTemplates'],
  KE_TOAN: ['inbox', 'orders', 'externalClaims', 'reports', 'merchantFulfilment', 'customerRefunds', 'cashback', 'dealerClaims', 'dealerAccounts', 'payouts'],
};
type WasteInboxKey =
  | 'wasteToCount'
  | 'wasteUnmatched'
  | 'wasteBlockedPending'
  | 'wastePointsPending'
  | 'wastePerksPending'
  | 'wasteTransitOverdue'
  | 'wasteGiftOverdue'
  | 'wasteOrderMismatch';
const WASTE_INBOX_SEEDS: Record<WasteInboxKey, Omit<WasteSeed, 'n'>> = {
  wasteToCount: { section: 'requests', preset: 'toCount' },
  wasteUnmatched: { section: 'requests', preset: 'unmatched' },
  wasteBlockedPending: { section: 'requests', preset: 'customerBlocked' },
  wastePointsPending: { section: 'points', preset: 'pending' },
  wastePerksPending: { section: 'points', preset: 'perk' },
  wasteTransitOverdue: { section: 'requests', preset: 'transitOverdue' },
  wasteGiftOverdue: { section: 'gifts', preset: 'overdue' },
  wasteOrderMismatch: { section: 'requests', preset: 'orderMismatch' },
};
const isWasteInboxKey = (k: InboxKey): k is WasteInboxKey => k in WASTE_INBOX_SEEDS;

function staffTabs(perms: readonly string[]): Set<Tab> {
  const out = new Set<Tab>(STAFF_TABS.BASE);
  for (const p of perms) for (const t of STAFF_TABS[p as StaffPermission] ?? []) out.add(t);
  return out;
}

const TAB_KEYS = new Set<Tab>(TABS.map((t) => t.k));
const ALL_TABS: ReadonlySet<Tab> = TAB_KEYS;

/** Tab đầu tiên (theo thứ tự thanh bên) mà người xem được phép mở; nơi rơi về khi URL xin tab bị cấm. */
function firstAllowedTab(allowed: ReadonlySet<Tab>): Tab {
  return TABS.find((t) => allowed.has(t.k))?.k ?? DEFAULT_TAB;
}

/**
 * Tab + bộ lọc đơn nằm trên URL (`/admin?tab=orders&recycling=attention`) để gửi link cho đồng nghiệp,
 * F5 không mất chỗ đang xem. Đọc window.location sau khi mount (không dùng useSearchParams — trang
 * client thuần, tránh bắt buộc Suspense boundary khi build).
 */
function readUrlState(): { tab: Tab | null; recycling: RecyclingFilter | ''; pancake: PancakeFilter | '' } {
  if (typeof window === 'undefined') return { tab: null, recycling: '', pancake: '' };
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get('tab');
  const r = sp.get('recycling');
  const p = sp.get('pancake');
  return {
    tab: t && TAB_KEYS.has(t as Tab) ? (t as Tab) : null,
    recycling: r === 'attention' || r === 'all' ? r : '',
    pancake: p === 'attention' || p === 'unsynced' ? p : '',
  };
}

function writeUrlState(tab: Tab, recycling: RecyclingFilter | '', pancake: PancakeFilter | '' = '') {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams();
  if (tab !== DEFAULT_TAB) sp.set('tab', tab);
  if (tab === 'orders' && recycling) sp.set('recycling', recycling);
  if (tab === 'orders' && pancake) sp.set('pancake', pancake);
  const qs = sp.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

export default function AdminPage() {
  const { user, status, initialized } = useAuth();
  const [tab, setTabState] = useState<Tab>(DEFAULT_TAB);
  const [ordersRecycling, setOrdersRecycling] = useState<RecyclingFilter | ''>('');
  const [ordersPancake, setOrdersPancake] = useState<PancakeFilter | ''>('');
  const [orderSeed, setOrderSeed] = useState<{ search: string; n: number; invoice?: InvoiceFilter } | null>(null);
  const [communitySeed, setCommunitySeed] = useState<{ view: CommunityView; n: number } | null>(null);
  const [wasteSeed, setWasteSeed] = useState<WasteSeed | null>(null);
  const [returnsSeed, setReturnsSeed] = useState<{ filter: ReturnsFilter; n: number } | null>(null);
  const [consignmentSeed, setConsignmentSeed] = useState(0);
  const role = user?.role;
  // Nhân viên: nhóm việc đọc lại từ API (JwtStrategy đọc DB) — gán/gỡ nhóm có hiệu lực mà không cần đăng nhập lại.
  const accessQ = useQuery({
    queryKey: ['admin-ops-access'],
    queryFn: getOpsAccess,
    enabled: status === 'authenticated' && role === 'STAFF',
  });

  useEffect(() => {
    const u = readUrlState();
    if (u.tab) setTabState(u.tab);
    if (u.recycling) setOrdersRecycling(u.recycling);
    if (u.pancake) setOrdersPancake(u.pancake);
  }, []);

  // Link mang tab bị cấm (vd KE_TOAN mở ?tab=users) vẫn hiện tab đầu được phép; sửa URL để link gửi tiếp và F5 không mang tab sai.
  // Chỉ chạm khi URL đang đúng là tab bị cấm và state đã nhận nó, để không ghi đè URL trước lượt khôi phục ở trên.
  useEffect(() => {
    if (!initialized || status !== 'authenticated') return;
    if (role !== 'ADMIN' && !(role === 'STAFF' && accessQ.data)) return;
    const allowedTabs: ReadonlySet<Tab> = role === 'ADMIN' ? ALL_TABS : staffTabs(accessQ.data?.staffPermissions ?? []);
    if (allowedTabs.has(tab) || readUrlState().tab !== tab) return;
    writeUrlState(firstAllowedTab(allowedTabs), '', '');
  }, [initialized, status, role, accessQ.data, tab]);

  const setTab = (t: Tab) => {
    setConsignmentSeed(0);
    setTabState(t);
    writeUrlState(t, t === 'orders' ? ordersRecycling : '', t === 'orders' ? ordersPancake : '');
  };
  const openRecyclingQueue = () => {
    setOrdersRecycling('attention');
    setOrdersPancake('');
    setTabState('orders');
    writeUrlState('orders', 'attention');
  };
  const openPancakeQueue = () => {
    setOrdersRecycling('');
    setOrdersPancake('attention');
    setTabState('orders');
    writeUrlState('orders', '', 'attention');
  };
  const openUnsyncedQueue = () => {
    setOrdersRecycling('');
    setOrdersPancake('unsynced');
    setTabState('orders');
    writeUrlState('orders', '', 'unsynced');
  };
  const openOrderByCode = (code: string) => {
    setOrdersRecycling('');
    setOrdersPancake('');
    setOrderSeed({ search: code, n: Date.now() });
    setTabState('orders');
    writeUrlState('orders', '');
  };
  const openConsignmentConfirm = () => {
    setConsignmentSeed(Date.now());
    setTabState('merchantProducts');
    writeUrlState('merchantProducts', '');
  };
  const openInbox = (k: InboxKey) => {
    if (k === 'pancakeAttention') return openPancakeQueue();
    if (k === 'consignmentPending') return openConsignmentConfirm();
    if (k === 'pancakeUnsynced') return openUnsyncedQueue();
    if (k === 'gomdonAttention') return openRecyclingQueue();
    if (k === 'returnsPending' || k === 'returnsToReceive') {
      setReturnsSeed({ filter: k === 'returnsToReceive' ? 'TO_RECEIVE' : 'REQUESTED', n: Date.now() });
      return setTab('returns');
    }
    if (k === 'communityPending' || k === 'communityUnanswered') {
      setCommunitySeed({ view: k === 'communityUnanswered' ? 'unanswered' : 'pending', n: Date.now() });
      return setTab('community');
    }
    if (isWasteInboxKey(k)) {
      setWasteSeed({ ...WASTE_INBOX_SEEDS[k], n: Date.now() });
      return setTab('waste');
    }
    if (k === 'invoicePending') {
      setOrdersRecycling('');
      setOrdersPancake('');
      setOrderSeed({ search: '', n: Date.now(), invoice: 'pending' });
      setTabState('orders');
      return writeUrlState('orders', '');
    }
    const target: Record<
      Exclude<
        InboxKey,
        | 'pancakeAttention'
        | 'pancakeUnsynced'
        | 'gomdonAttention'
        | 'returnsPending'
        | 'returnsToReceive'
        | 'consignmentPending'
        | 'communityPending'
        | 'communityUnanswered'
        | 'invoicePending'
        | WasteInboxKey
      >,
      Tab
    > = {
      customerRefunds: 'customerRefunds',
      merchantOverdue: 'merchantFulfilment',
      merchantProducts: 'merchantProducts',
      merchantToSettle: 'merchantFulfilment',
      merchantPayoutsPending: 'merchantFulfilment',
      dealerApplications: 'dealers',
      dealerClaims: 'dealerClaims',
      dealerClaimsToPay: 'dealerClaims',
      payouts: 'payouts',
      payoutsToPay: 'payouts',
      externalPoints: 'externalClaims',
    };
    setTab(target[k]);
  };
  const onRecyclingFilterChange = (r: RecyclingFilter | '') => {
    setOrdersRecycling(r);
    writeUrlState('orders', r, ordersPancake);
  };
  const onPancakeFilterChange = (pf: PancakeFilter | '') => {
    setOrdersPancake(pf);
    writeUrlState('orders', ordersRecycling, pf);
  };

  // Chờ lượt khôi phục phiên chạy xong: render đầu tiên luôn là 'idle' (xem AuthState.initialized),
  // không chờ thì màn "Cần đăng nhập quản trị" chớp lên mỗi lần F5.
  if (!initialized || status === 'loading') return <Center>Đang tải…</Center>;
  if (status !== 'authenticated')
    return (
      <Center>
        Cần đăng nhập quản trị.{' '}
        <Link href="/dang-nhap" className="inline-flex min-h-[44px] items-center font-semibold text-forest-700 underline">Đăng nhập</Link>
      </Center>
    );
  if (role !== 'ADMIN' && role !== 'STAFF') return <Center>Bạn không có quyền truy cập trang quản trị.</Center>;
  if (role === 'STAFF' && accessQ.isLoading) return <Center>Đang tải…</Center>;
  if (role === 'STAFF' && !accessQ.data) return <Center>Không tải được quyền của bạn. Tải lại trang để thử lại.</Center>;

  const isAdmin = role === 'ADMIN';
  const allowed: ReadonlySet<Tab> = isAdmin ? ALL_TABS : staffTabs(accessQ.data?.staffPermissions ?? []);
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed.has(i.k)) })).filter((g) => g.items.length > 0);
  const active: Tab = allowed.has(tab) ? tab : firstAllowedTab(allowed);
  const canReviewReturns = isAdmin || (accessQ.data?.staffPermissions ?? []).includes('CSKH');
  const canReceiveReturns = isAdmin || (accessQ.data?.staffPermissions ?? []).includes('KHO');
  const returnsDefault: ReturnsFilter = canReceiveReturns && !canReviewReturns ? 'TO_RECEIVE' : 'REQUESTED';

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-semibold text-stone-900">Quản trị Tubu Tree</h1>
        <Link href="/admin/pos" className="inline-flex min-h-[44px] items-center rounded-control border border-stone-450 bg-stone-0 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 sm:min-h-[36px]">
          Màn thu ngân (tích điểm tại quầy)
        </Link>
      </div>
      <div className="mt-4 lg:flex lg:items-start lg:gap-6">
        <AdminNav
          groups={groups}
          active={active}
          onSelect={setTab}
          badge={(k) => (k === 'customerRefunds' ? <CustomerRefundsPendingBadge /> : null)}
        />
        <div className="mt-4 min-w-0 flex-1 lg:mt-0">
          {active === 'inbox' && <OpsInboxTab onOpen={openInbox} />}
          {active === 'dashboard' && <DashboardTab onSelectTab={setTab} onOpenRecyclingQueue={openRecyclingQueue} onOpenPancakeQueue={openPancakeQueue} />}
          {active === 'dealers' && <DealersTab />}
          {active === 'dealerClaims' && <DealerClaimsTab canReview={isAdmin} />}
          {active === 'dealerAccounts' && <DealerAccountsTab isAdmin={isAdmin} />}
          {active === 'dealerPrices' && <DealerPriceHistoryTab />}
          {active === 'commissionRates' && <CommissionRatesTab />}
          {active === 'productCategories' && <ProductCategoriesTab />}
          {active === 'engagement' && <EngagementTab />}
          {active === 'externalOrders' && <ExternalOrdersTab isAdmin={isAdmin} />}
          {active === 'externalClaims' && <ExternalClaimsTab isAdmin={isAdmin} meId={user?.id} canAct={isAdmin || (accessQ.data?.staffPermissions ?? []).includes('CSKH')} />}
          {active === 'community' && <CommunityModerationTab key={communitySeed?.n ?? 0} initialView={communitySeed?.view} isAdmin={isAdmin} />}
          {active === 'payouts' && <PayoutAdminTab canReview={isAdmin} />}
          {active === 'customerRefunds' && <CustomerRefundsTab meId={user?.id} isAdmin={isAdmin} />}
          {active === 'orders' && (
            <OrdersTab
              key={orderSeed?.n ?? 0}
              initialSearch={orderSeed?.search}
              initialInvoice={orderSeed?.invoice}
              isAdmin={isAdmin}
              canFinance={isAdmin || (accessQ.data?.staffPermissions ?? []).includes('KE_TOAN')}
              canWarehouse={isAdmin || (accessQ.data?.staffPermissions ?? []).includes('KHO')}
              recycling={ordersRecycling}
              onRecyclingChange={onRecyclingFilterChange}
              pancake={ordersPancake}
              onPancakeChange={onPancakeFilterChange}
            />
          )}
          {active === 'returns' && (
            <ReturnsTab
              key={`${returnsSeed?.n ?? 0}-${returnsDefault}`}
              initialFilter={returnsSeed?.filter ?? returnsDefault}
              canReview={canReviewReturns}
              canReceive={canReceiveReturns}
            />
          )}
          {active === 'cashback' && <CashbackTab />}
          {active === 'posCredits' && <PosCreditsTab />}
          {active === 'users' && <UsersTab isAdmin={isAdmin} />}
          {active === 'users' && isAdmin && <AccountDeletionPanel />}
          {active === 'reviews' && <ReviewsTab />}
          {active === 'subscriptions' && <SubscriptionsTab />}
          {active === 'waste' && <WasteTab key={wasteSeed?.n ?? 0} isAdmin={isAdmin} seed={wasteSeed} />}
          {active === 'config' && <ConfigTab />}
          {active === 'opsHealth' && <OpsHealthTab onOpenOrder={openOrderByCode} isAdmin={isAdmin} />}
          {active === 'attendance' && <AttendanceTab />}
          {active === 'staffRoster' && <StaffRosterTab />}
          {active === 'shiftApproval' && <ShiftApprovalTab />}
          {active === 'payroll' && <PayrollAdminTab />}
          {active === 'coupons' && <CouponsTab />}
          {active === 'brands' && <BrandsTab />}
          {active === 'storefronts' && <StorefrontsTab />}
          {active === 'merchantProducts' && <MerchantProductsTab key={consignmentSeed} focusConsignment={consignmentSeed > 0} />}
          {active === 'merchantFulfilment' && <MerchantFulfilmentTab onOpenConsignmentConfirm={openConsignmentConfirm} isAdmin={isAdmin} />}
          {active === 'flashSales' && <FlashSalesTab />}
          {active === 'faqs' && <FaqTab />}
          {active === 'contentKit' && <ContentKitTab />}
          {active === 'academy' && <AcademyTab />}
          {active === 'quickReplies' && <QuickReplyTab />}
          {active === 'notificationTemplates' && <NotificationTemplatesTab canEditAll={isAdmin} />}
          {active === 'analytics' && <AnalyticsTab />}
          {active === 'reports' && <ReportsTab sections={reportSectionsFor(isAdmin, accessQ.data?.staffPermissions ?? [])} />}
        </div>
      </div>
    </main>
  );
}

function DealersTab() {
  const [filter, setFilter] = useState('PENDING');
  // Phân trang thật + "Tải thêm": trước đây chỉ lấy 1 trang (limit 100) và vứt meta → quá 100 hồ sơ thì
  // phần cũ nhất (chờ lâu nhất) biến mất khỏi màn hình mà không ai biết.
  const q = useInfiniteQuery({
    queryKey: ['admin-dealers', filter],
    queryFn: ({ pageParam }) =>
      listDealerApps(filter || undefined, pageParam, undefined, filter === 'PENDING' ? 'asc' : undefined),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const pending = filter === 'PENDING';
  const view = mergeQueuePages(q.data?.pages, pending);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          aria-label="Lọc hồ sơ đại lý theo trạng thái"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={`${FIELD_CLASS} ${TOUCH_H}`}
        >
          {DEALER_APP_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        {q.data && (
          <span className="text-xs text-stone-500">
            {view.label} hồ sơ{pending ? ' · cũ nhất trước' : ''}
          </span>
        )}
      </div>
      <QueueMoreNotice pending={pending} view={view} noun="hồ sơ" />
      <div className="mt-3 space-y-3">
        {q.isError && <LoadError message="Không tải được danh sách hồ sơ đại lý." onRetry={() => void q.refetch()} />}
        {q.isLoading && <p className="text-sm text-stone-500">Đang tải danh sách hồ sơ…</p>}
        {view.items.map((a) => <DealerRow key={a.id} app={a} />)}
        {q.data && view.items.length === 0 && <Empty>Không có hồ sơ.</Empty>}
      </div>
      <LoadMoreButton
        hasMore={view.hasMore}
        loading={q.isFetchingNextPage}
        onClick={() => void q.fetchNextPage()}
        error={q.isFetchNextPageError}
      />
    </div>
  );
}

/**
 * Hàng CHỜ duyệt mà còn trang chưa tải: API trả cũ nhất trước (order=asc) nên phần CHƯA tải là các
 * mục MỚI hơn — báo rõ để admin biết danh sách chưa hết.
 */
function QueueMoreNotice({ pending, view, noun }: { pending: boolean; view: { total: number; items: unknown[]; hasMore: boolean }; noun: string }) {
  if (!pending || !view.hasMore) return null;
  return (
    <p className="mt-2 rounded-control border border-warning-fg bg-warning-bg px-3 py-2 text-xs text-warning-fg">
      Còn {view.total - view.items.length} {noun} mới hơn chưa tải — bấm &quot;Tải thêm&quot; để xem tiếp.
    </p>
  );
}

function LoadMoreButton({ hasMore, loading, error, onClick }: { hasMore: boolean; loading: boolean; error: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="mt-3 text-center">
      {error && <p className="mb-1 text-xs text-danger-fg">Không tải thêm được, thử lại.</p>}
      <button type="button" onClick={onClick} disabled={loading} className={BTN_SECONDARY}>
        {loading ? 'Đang tải…' : 'Tải thêm'}
      </button>
    </div>
  );
}

/** Lỗi tải danh sách kèm nút thử lại: mất mạng vài giây thì không phải F5 cả trang và mất bộ lọc đang chọn. */
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-danger-fg">{message}</p>
      <button type="button" onClick={onRetry} className={BTN_SECONDARY}>
        Thử lại
      </button>
    </div>
  );
}

/** Xoá/gỡ không hoàn tác: hỏi trước, chỉ chạy khi admin đồng ý (cùng cách với xoá đợt flash sale). */
function useDeleteConfirm() {
  const { confirm, dialog } = useConfirm();
  const askDelete = async (opts: { title: string; message: string; confirmLabel: string }, run: () => void) => {
    if (await confirm({ cancelLabel: 'Giữ lại', tone: 'danger', ...opts })) run();
  };
  return { askDelete, dialog };
}

function DealerRow({ app: a }: { app: DealerApp }) {
  const qc = useQueryClient();
  const [tierId, setTierId] = useState('');
  const { ask, dialog } = useConfirm();
  const review = useMutation({
    mutationFn: ({ approve, reason }: { approve: boolean; reason?: string }) =>
      reviewDealerApp(a.id, approve, approve ? tierId.trim() || undefined : undefined, approve ? undefined : reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-dealers'] }),
  });
  // Từ chối là trạng thái cuối và lý do được gửi nguyên văn cho người nộp, nên bắt admin tự viết.
  // API báo lỗi (vd hồ sơ vừa bị admin khác xử lý) thì mở lại hộp với lý do đã gõ, không bắt gõ lại.
  const askReject = async () => {
    let initial = '';
    let error: string | undefined;
    for (;;) {
      const reason = await ask({
        title: 'Từ chối hồ sơ đại lý',
        message: `Từ chối hồ sơ "${a.businessName}"? Không mở lại được: người nộp phải nộp lại từ đầu và sẽ nhận lý do bạn nhập dưới đây.`,
        confirmLabel: 'Từ chối hồ sơ',
        cancelLabel: 'Giữ lại',
        tone: 'danger',
        input: { label: 'Lý do từ chối (gửi cho người nộp)', placeholder: 'Ví dụ: ảnh CCCD mặt sau bị mờ, nộp lại giúp', required: true, initial, error },
      });
      if (!reason) return;
      try {
        await review.mutateAsync({ approve: false, reason });
        return;
      } catch (e) {
        initial = reason;
        error = e instanceof Error ? e.message : 'Không từ chối được, thử lại.';
      }
    }
  };

  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4">
      <div className="flex justify-between gap-2">
        <span className="min-w-0 break-words font-medium text-stone-900">{a.businessName}</span>
        <span className="shrink-0 text-xs text-stone-500">{dealerAppStatusLabel(a.status)}</span>
      </div>
      <div className="break-words text-sm text-stone-600">{a.ownerName} · {a.phone}</div>
      <div className="break-words text-sm text-stone-600">{a.address}</div>
      <div className="mt-2 flex gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.cccdFrontUrl && <img src={a.cccdFrontUrl} alt="CCCD trước" className="h-16 rounded-control border border-stone-200" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.cccdBackUrl && <img src={a.cccdBackUrl} alt="CCCD sau" className="h-16 rounded-control border border-stone-200" />}
      </div>
      {a.status === 'PENDING' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DealerTierSelect value={tierId} onChange={setTierId} className="min-w-0 flex-1" />
          <button
            onClick={() => review.mutate({ approve: true })}
            disabled={review.isPending || !tierId.trim()}
            title={!tierId.trim() ? 'Cần chọn bậc đại lý để duyệt' : undefined}
            className={BTN_PRIMARY}
          >
            Duyệt
          </button>
          <button onClick={askReject} disabled={review.isPending} className={BTN_DANGER_OUTLINE}>Từ chối</button>
        </div>
      )}
      {review.isError && <p className="mt-1 text-xs text-danger-fg">{(review.error as Error).message}</p>}
      {dialog}
    </div>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const label = ORDER_STATUS_LABELS[status] ?? status;
  let color = 'bg-stone-100 text-stone-700';
  if (status === 'PENDING_PAYMENT') color = 'bg-warning-bg text-warning-fg';
  else if (status === 'CONFIRMED') color = 'bg-info-bg text-info-fg';
  else if (status === 'PACKED') color = 'bg-sage-100 text-sage-700';
  else if (status === 'SHIPPING') color = 'bg-forest-100 text-forest-800';
  else if (status === 'DELIVERED') color = 'bg-success-bg text-success-fg font-semibold';
  else if (status === 'CANCELLED') color = 'bg-danger-bg text-danger-fg';
  else if (status === 'RETURNED') color = 'bg-promo-bg text-promo-fg';

  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs ${color}`}>{label}</span>;
}

function DashboardTab({
  onSelectTab,
  onOpenRecyclingQueue,
  onOpenPancakeQueue,
}: {
  onSelectTab: (tab: Tab) => void;
  onOpenRecyclingQueue: () => void;
  onOpenPancakeQueue: () => void;
}) {
  const q = useQuery({ queryKey: ['admin-dashboard-stats'], queryFn: getDashboardStats });
  const recyclingQ = useQuery({ queryKey: ['admin-recycling-count'], queryFn: countRecyclingAttention });
  const pancakeQ = useQuery({ queryKey: PANCAKE_ATTENTION_COUNT_KEY, queryFn: countPancakeAttention });
  const pendingClaimsQ = useQuery({
    queryKey: ['admin-dealer-claims', 'PENDING', 'count'],
    queryFn: () => listDealerRewardClaims('PENDING', 1, 1).then((r) => r.meta.total),
  });
  // P0 A5-08=A6-05: trước đây Payout REQUESTED không hiện ở đâu cả — tiền "biến mất" khỏi mọi
  // hàng đợi xử lý được. Badge này là lối vào chính để admin biết có lệnh rút đang chờ.
  const pendingPayoutsQ = useQuery({
    queryKey: ['admin-payouts', 'REQUESTED', 'count'],
    queryFn: () => listPayouts('REQUESTED', 1, 1).then((r) => r.meta.total),
  });

  if (q.isLoading) return <p className="text-sm text-stone-500">Đang tải số liệu tổng quan…</p>;
  if (q.isError || !q.data) return <LoadError message="Không tải được số liệu tổng quan KPI." onRetry={() => void q.refetch()} />;

  const stats = q.data;

  return (
    <div className="space-y-6">
      {(pancakeQ.data ?? 0) > 0 && (
        <button
          type="button"
          onClick={onOpenPancakeQueue}
          className="flex w-full items-center justify-between gap-3 rounded-card border border-danger-fg bg-danger-bg px-4 py-3 text-left text-sm text-danger-fg hover:brightness-95"
        >
          <span>
            <AlertTriangle aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            <b>{pancakeQ.data}</b> đơn cần xử lý theo báo cáo Pancake (đơn bị xoá / đang hoàn / đã nhận tiền khi đơn đã huỷ…)
          </span>
          <span className="shrink-0 font-semibold">Xử lý ngay →</span>
        </button>
      )}
      {(recyclingQ.data ?? 0) > 0 && (
        <button
          type="button"
          onClick={onOpenRecyclingQueue}
          className="flex w-full items-center justify-between gap-3 rounded-card border border-danger-fg bg-danger-bg px-4 py-3 text-left text-sm text-danger-fg hover:brightness-95"
        >
          <span>
            <Recycle aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            <b>{recyclingQ.data}</b> đơn thu kèm Gomdon cần xử lý (vận đơn Gomdon lỗi / hoàn / huỷ không được)
          </span>
          <span className="shrink-0 font-semibold">Xử lý ngay →</span>
        </button>
      )}
      {(pendingClaimsQ.data ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => onSelectTab('dealerClaims')}
          className="flex w-full items-center justify-between gap-3 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-left text-sm text-warning-fg hover:brightness-95"
        >
          <span>
            <Trophy aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            <b>{pendingClaimsQ.data}</b> yêu cầu nhận thưởng đại lý đang chờ duyệt
          </span>
          <span className="shrink-0 font-semibold">Xem →</span>
        </button>
      )}
      {(pendingPayoutsQ.data ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => onSelectTab('payouts')}
          className="flex w-full items-center justify-between gap-3 rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-left text-sm text-warning-fg hover:brightness-95"
        >
          <span>
            <Banknote aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-text-bottom" />
            <b>{pendingPayoutsQ.data}</b> lệnh rút tiền (hoa hồng CTV / Ví) đang chờ duyệt
          </span>
          <span className="shrink-0 font-semibold">Xem →</span>
        </button>
      )}
      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Doanh thu */}
        <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">Doanh thu đã thu</div>
          <div className="mt-2 text-2xl font-bold text-forest-700">{formatVnd(stats.totalRevenue)}</div>
          <div className="mt-1 text-xs text-stone-500">Đã thanh toán hoặc COD Tubu đã thu; trừ đơn huỷ/trả, tiền hoàn, đơn ghi công nợ và COD gian hàng tự giao</div>
          {stats.gmv !== undefined && (
            <dl className="mt-2 space-y-0.5 text-xs text-stone-600" data-kpi-revenue-breakdown>
              <div className="flex justify-between gap-2">
                <dt>Giá trị đơn còn hiệu lực</dt>
                <dd className="font-medium text-stone-900">{formatVnd(stats.gmv)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>COD chưa thu</dt>
                <dd className="font-medium text-warning-fg">{formatVnd(stats.codPendingValue ?? 0)}</dd>
              </div>
              {(stats.dealerDebtOutstanding ?? 0) > 0 && (
                <div className="flex justify-between gap-2">
                  <dt>Công nợ đại lý chưa thu</dt>
                  <dd className="font-medium text-warning-fg">{formatVnd(stats.dealerDebtOutstanding ?? 0)}</dd>
                </div>
              )}
            </dl>
          )}
        </div>

        {/* Đơn hàng */}
        <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">Tổng đơn hàng</div>
          <div className="mt-2 text-2xl font-bold text-stone-900">{stats.totalOrders}</div>
          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
            <span className="rounded bg-warning-bg px-1.5 py-0.5 font-medium text-warning-fg">{stats.pendingOrders} chờ xử lý</span>
            <span className="rounded bg-info-bg px-1.5 py-0.5 font-medium text-info-fg">{stats.shippingOrders} đang giao</span>
            <span className="rounded bg-success-bg px-1.5 py-0.5 font-medium text-success-fg">{stats.deliveredOrders} đã giao</span>
            {stats.cancelledOrders > 0 && (
              <span className="rounded bg-danger-bg px-1.5 py-0.5 font-medium text-danger-fg">{stats.cancelledOrders} đã hủy</span>
            )}
            {(stats.returnedOrders ?? 0) > 0 && (
              <span className="rounded bg-promo-bg px-1.5 py-0.5 font-medium text-promo-fg">{stats.returnedOrders} đã trả hàng</span>
            )}
          </div>
          {stats.returnRefundTotal !== undefined && (
            <button
              type="button"
              onClick={() => onSelectTab('returns')}
              className="mt-2 min-h-[44px] text-left text-xs text-stone-600 underline-offset-2 hover:underline sm:min-h-0"
            >
              Đã hoàn khi trả hàng: <b className="text-stone-900">{formatVnd(stats.returnRefundTotal)}</b>
              {(stats.pendingReturns ?? 0) > 0 && <> · <b className="text-warning-fg">{stats.pendingReturns}</b> yêu cầu chờ duyệt</>}
            </button>
          )}
        </div>

        {/* Khách hàng & Đối tác */}
        <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">Cộng đồng & Đối tác</div>
          <div className="mt-2 text-2xl font-bold text-stone-900">{stats.totalUsers} <span className="text-xs font-normal text-stone-500">người dùng</span></div>
          <div className="mt-1 text-xs text-stone-600">
            Trong đó: <span className="font-semibold text-forest-700">{stats.totalAffiliates}</span> đối tác CTV / Affiliate
          </div>
        </div>

        {/* Sản phẩm & Quỹ trồng cây */}
        <div className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">Sản phẩm & Quỹ trồng cây</div>
          <div className="mt-2 text-2xl font-bold text-stone-900">{stats.totalProducts} <span className="text-xs font-normal text-stone-500">sản phẩm</span></div>
          <div className="mt-1 flex items-center gap-1 text-xs font-medium text-forest-700">
            <TreePine aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {stats.plantedTreesCount} cây góp quỹ trồng cây
          </div>
        </div>
      </div>

      {/* Recent Orders Section */}
      <div className="rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3">
          <div>
            <h2 className="font-display font-semibold text-stone-900">Đơn hàng mới nhất</h2>
            <p className="text-xs text-stone-500">Theo dõi các đơn hàng phát sinh gần nhất trong hệ thống</p>
          </div>
          <button
            onClick={() => onSelectTab('orders')}
            className="min-h-[44px] rounded-control bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-200 sm:min-h-[36px]"
          >
            Quản lý tất cả đơn hàng →
          </button>
        </div>

        {/* Điện thoại: bảng 6 cột phải vuốt ngang mới thấy tổng tiền và trạng thái, nên mỗi đơn là một thẻ hai dòng. */}
        <ul data-recent-orders-cards className="mt-3 divide-y divide-stone-100 sm:hidden">
          {stats.recentOrders.length === 0 ? (
            <li className="py-6 text-center text-xs text-stone-500">Chưa có đơn hàng nào.</li>
          ) : (
            stats.recentOrders.map((o) => (
              <li key={o.id} className="py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-semibold text-stone-800">{o.code}</span>
                  <span className="shrink-0 font-semibold text-forest-700">{formatVnd(o.total)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-stone-500">
                  <span className="min-w-0 break-words">
                    {o.user?.fullName ?? 'Khách lẻ'} · {PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod} · {formatDateTime(o.createdAt)}
                  </span>
                  <OrderStatusBadge status={o.status} />
                </div>
              </li>
            ))
          )}
        </ul>

        <ScrollRegion label="Đơn hàng gần đây" className="mt-3 hidden sm:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Mã đơn</th>
                <th className="px-3 py-2 font-medium">Khách hàng</th>
                <th className="px-3 py-2 font-medium">Thanh toán</th>
                <th className="px-3 py-2 font-medium">Tổng tiền</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-xs text-stone-500">Chưa có đơn hàng nào.</td>
                </tr>
              ) : (
                stats.recentOrders.map((o) => (
                  <tr key={o.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-3 py-2.5 font-semibold text-stone-800">{o.code}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-stone-900">{o.user?.fullName ?? 'Khách lẻ'}</div>
                      {o.user?.phone && <div className="text-xs text-stone-500">{o.user.phone}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-stone-600">
                      {PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-forest-700">{formatVnd(o.total)}</td>
                    <td className="px-3 py-2.5">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-stone-500">
                      {formatDateTime(o.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollRegion>
      </div>
    </div>
  );
}

const RECYCLING_FILTERS: { k: RecyclingFilter | ''; label: string }[] = [
  { k: '', label: 'Mọi đơn' },
  { k: 'all', label: 'Có thu gom' },
  { k: 'attention', label: 'Cần xử lý thu gom' },
];

function OrdersTab({
  recycling,
  onRecyclingChange,
  pancake,
  onPancakeChange,
  isAdmin = true,
  canFinance = true,
  canWarehouse = true,
  initialSearch,
  initialInvoice,
}: {
  recycling: RecyclingFilter | '';
  onRecyclingChange: (r: RecyclingFilter | '') => void;
  pancake: PancakeFilter | '';
  onPancakeChange: (p: PancakeFilter | '') => void;
  isAdmin?: boolean;
  /** Tiền đơn (Đã nhận tiền, hoá đơn VAT, công nợ đại lý, CSV) — API mở cho ADMIN và nhân viên KE_TOAN. */
  canFinance?: boolean;
  /** Thao tác kho (đẩy lại Pancake, xử lý Pancake/thu gom) — API chỉ mở cho ADMIN và nhân viên KHO. */
  canWarehouse?: boolean;
  initialSearch?: string;
  initialInvoice?: InvoiceFilter;
}) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState(initialSearch ?? '');
  const [search, setSearch] = useState(initialSearch ?? '');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceFilter | ''>(initialInvoice ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [extra, setExtra] = useState<OrderListExtra>({});
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  // Điện thoại: chi tiết đơn mở trong ngăn kéo thay vì chen vào giữa bảng đang cuộn ngang.
  const narrow = useNarrowScreen();
  const badRange = !!from && !!to && from > to;

  const q = useQuery({
    queryKey: ['admin-orders', page, status, search, recycling, invoice, pancake, from, to, extra],
    queryFn: () =>
      listOrders(
        page,
        status || undefined,
        search || undefined,
        recycling || undefined,
        20,
        invoice || undefined,
        pancake || undefined,
        from || undefined,
        to || undefined,
        extra,
      ),
    enabled: !badRange,
  });
  const exportAll = async () => {
    setExportMsg(null);
    setExporting(true);
    try {
      const r = await downloadOrdersCsv({
        status: status || undefined,
        search: search || undefined,
        recycling: recycling || undefined,
        invoice: invoice || undefined,
        pancake: pancake || undefined,
        from: from || undefined,
        to: to || undefined,
        ...orderExtraFilters(extra),
      });
      setExportMsg({ ok: true, text: `Đã tải ${r.filename} — mọi đơn khớp bộ lọc, không chỉ trang đang xem.` });
    } catch (e) {
      setExportMsg({ ok: false, text: e instanceof Error ? e.message : 'Không xuất được CSV.' });
    } finally {
      setExporting(false);
    }
  };
  const expandedOrder = q.data?.data.find((o) => (o.id || o.code) === expandedId) ?? null;
  const attentionQ = useQuery({ queryKey: ['admin-recycling-count'], queryFn: countRecyclingAttention });
  const pancakeQ = useQuery({ queryKey: PANCAKE_ATTENTION_COUNT_KEY, queryFn: countPancakeAttention });
  const pancakeCount = pancakeQ.data ?? 0;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
    setPage(1);
  };

  const totalPages = q.data ? Math.ceil(q.data.meta.total / q.data.meta.limit) : 1;

  return (
    <div className="space-y-4">
      {/* Search, Filter, and Export bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
        <form onSubmit={handleSearchSubmit} className="flex min-w-[260px] flex-1 items-center gap-2">
          <input
            type="text"
            aria-label="Tìm đơn theo mã đơn, mã vận đơn, mã Pancake, SĐT, tên khách hoặc tên người nhận"
            placeholder={narrow ? 'Mã đơn, SĐT, tên…' : 'Tìm mã đơn, vận đơn, SĐT, tên khách hoặc người nhận…'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={`${FIELD_CLASS} ${TOUCH_H} flex-1`}
          />
          <button
            type="submit"
            className={`${BTN_PRIMARY} whitespace-nowrap`}
          >
            Tìm kiếm
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setPage(1);
              }}
              className={`${BTN_SECONDARY} whitespace-nowrap`}
            >
              Xóa lọc
            </button>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Lọc đơn theo trạng thái"
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className={`${FIELD_CLASS} ${TOUCH_H}`}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="PENDING_PAYMENT">Chờ thanh toán</option>
            <option value="CONFIRMED">Đã xác nhận</option>
            <option value="PACKED">Đã đóng gói</option>
            <option value="SHIPPING">Đang vận chuyển</option>
            <option value="DELIVERED">Đã giao hàng</option>
            <option value="CANCELLED">Đã hủy</option>
            <option value="RETURNED">Đã trả hàng</option>
          </select>

          {canFinance && (
            <button
              type="button"
              onClick={() => void exportAll()}
              disabled={exporting || badRange || !q.data || q.data.meta.total === 0}
              className={`${BTN_SECONDARY} flex items-center gap-1.5 whitespace-nowrap`}
              title="Xuất mọi đơn khớp bộ lọc ra file CSV cho Excel / kế toán"
            >
              <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
              {exporting ? 'Đang xuất…' : 'Xuất CSV (Excel)'}
            </button>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 text-xs text-stone-600">
          <label className="flex items-center gap-1.5">
            Từ ngày
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className={`${FIELD_CLASS} ${TOUCH_H}`}
            />
          </label>
          <label className="flex items-center gap-1.5">
            đến
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className={`${FIELD_CLASS} ${TOUCH_H}`}
            />
          </label>
          {(from || to) && (
            <button
              type="button"
              onClick={() => {
                setFrom('');
                setTo('');
                setPage(1);
              }}
              className={BTN_SMALL}
            >
              Bỏ lọc ngày
            </button>
          )}
          {badRange && <span className="text-danger-fg">Ngày bắt đầu phải trước ngày kết thúc.</span>}
        </div>
        {exportMsg && (
          <p role="status" className={`w-full text-xs ${exportMsg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
            {exportMsg.text}
          </p>
        )}
      </div>

      <OrderExtraFilters
        value={extra}
        onChange={(v) => {
          setPage(1);
          setExpandedId(null);
          setExtra(v);
        }}
      />

      {/* Bộ lọc đơn thu kèm Gomdon */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Lọc đơn thu kèm Gomdon">
        {RECYCLING_FILTERS.map((f) => {
          const active = recycling === f.k;
          const count = f.k === 'attention' ? attentionQ.data : undefined;
          return (
            <button
              key={f.k || 'none'}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setPage(1);
                setExpandedId(null);
                onRecyclingChange(f.k);
              }}
              className={`min-h-[44px] rounded-full px-3 py-1 text-xs font-medium sm:min-h-[32px] ${
                active
                  ? f.k === 'attention'
                    ? 'bg-danger-fg text-stone-0'
                    : 'bg-forest-600 text-stone-0'
                  : f.k === 'attention' && (count ?? 0) > 0
                    ? 'bg-danger-bg text-danger-fg ring-1 ring-danger-fg'
                    : 'bg-stone-100 text-stone-700'
              }`}
            >
              {f.k === 'all' && <Recycle aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />}
              {f.label}
              {count !== undefined && ` (${count})`}
            </button>
          );
        })}
        {recycling === 'attention' && (
          <span className="text-xs text-stone-500">
            Vận đơn Gomdon tạo lỗi / cần kiểm tra / chưa cấu hình, hoặc Gomdon báo huỷ-hoàn-thất bại khi đơn còn mở; đơn huỷ mà huỷ vận đơn
            không được.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={pancake === 'attention'}
          onClick={() => {
            setPage(1);
            setExpandedId(null);
            onPancakeChange(pancake === 'attention' ? '' : 'attention');
          }}
          className={`min-h-[44px] rounded-full px-3 py-1 text-xs font-medium sm:min-h-[32px] ${
            pancake === 'attention'
              ? 'bg-danger-fg text-stone-0'
              : pancakeCount > 0
                ? 'bg-danger-bg text-danger-fg ring-1 ring-danger-fg'
                : 'bg-stone-100 text-stone-700'
          }`}
        >
          <AlertTriangle aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
          Cần xử lý Pancake{pancakeQ.data !== undefined && ` (${pancakeQ.data})`}
        </button>
        <button
          type="button"
          aria-pressed={pancake === 'unsynced'}
          onClick={() => {
            setPage(1);
            setExpandedId(null);
            onPancakeChange(pancake === 'unsynced' ? '' : 'unsynced');
          }}
          className={`min-h-[44px] rounded-full px-3 py-1 text-xs font-medium sm:min-h-[32px] ${
            pancake === 'unsynced' ? 'bg-forest-600 text-stone-0' : 'bg-stone-100 text-stone-700'
          }`}
        >
          Chưa lên Pancake
        </button>
        {pancake === 'attention' && (
          <span className="text-xs text-stone-500">
            Pancake báo trạng thái hệ thống không tự áp được: đơn bị xoá, đang hoàn / hoàn một phần, đã nhận tiền khi đơn đã huỷ, báo
            đã giao khi đơn đang do Gomdon giao…
          </span>
        )}
        {pancake === 'unsynced' && (
          <span className="text-xs text-stone-500">
            Đơn còn trong kho mà kho Pancake chưa có: đẩy lỗi, quá hạn tự đẩy, Pancake chưa cấu hình, hoặc chưa đẩy sau 15 phút.
          </span>
        )}
      </div>

      {/* Bộ lọc đơn yêu cầu hoá đơn VAT */}
      <InvoiceFilterChips
        value={invoice}
        onChange={(v) => {
          setPage(1);
          setExpandedId(null);
          setInvoice(v);
        }}
      />

      {/* Orders Table */}
      {q.isError && (
        <LoadError
          message={`Không tải được danh sách đơn hàng${q.error instanceof Error ? `: ${q.error.message}` : '.'}`}
          onRetry={() => void q.refetch()}
        />
      )}
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải danh sách đơn hàng…</p>}

      {q.data && (
        <ScrollRegion label="Danh sách đơn hàng" className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Mã đơn</th>
                <th className="px-3 py-2.5 font-medium">Khách hàng</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Thanh toán</th>
                <th className="px-3 py-2.5 font-medium">Tổng tiền</th>
                <th className="hidden whitespace-nowrap px-3 py-2.5 font-medium md:table-cell">Trạng thái</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Ngày đặt</th>
                <th className="hidden whitespace-nowrap px-3 py-2.5 text-right font-medium md:table-cell">Chi tiết / Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-stone-500">
                    Không tìm thấy đơn hàng nào phù hợp.
                  </td>
                </tr>
              ) : (
                q.data.data.map((o) => {
                  const isExpanded = expandedId === (o.id || o.code);
                  return (
                    <React.Fragment key={o.id || o.code}>
                      <tr
                        className={`border-t border-stone-100 hover:bg-stone-50 ${narrow ? 'cursor-pointer' : ''}`}
                        onClick={narrow ? () => setExpandedId(o.id || o.code) : undefined}
                      >
                        <td className="px-3 py-3">
                          {narrow ? (
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedId(o.id || o.code);
                              }}
                              className="-my-2 min-h-[44px] text-left font-semibold text-forest-700 underline decoration-forest-300 underline-offset-2"
                            >
                              {o.code}
                            </button>
                          ) : (
                            <div className="font-semibold text-stone-800">{o.code}</div>
                          )}
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {o.fulfiller === 'MERCHANT' && (
                              <ToneBadge tone="info" title={o.fulfillerStorefront?.title ?? undefined}>
                                Gian hàng tự giao
                              </ToneBadge>
                            )}
                            <RecyclingBadge order={o} />
                            <PancakeAttentionBadge order={o} />
                            <PancakeSyncBadge order={o} />
                          </div>
                          <div className="mt-1 space-y-1 md:hidden">
                            <OrderStatusBadge status={o.status} />
                            <div className="text-[11px] text-stone-500">
                              {formatDate(o.createdAt)} · {PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod}
                            </div>
                            {o.paymentStatus && <PaymentStatusShort order={o} />}
                          </div>
                        </td>
                        <td className="min-w-[9rem] px-3 py-3">
                          <div className="font-medium text-stone-900">{o.user?.fullName ?? 'Khách lẻ'}</div>
                          {o.user?.phone && <div className="text-xs text-stone-500">{o.user.phone}</div>}
                          <OrderRecipientLine order={o} />
                        </td>
                        <td className="hidden px-3 py-3 md:table-cell">
                          <div className="text-xs font-medium text-stone-700">
                            {PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod}
                          </div>
                          {o.paymentStatus && <PaymentStatusShort order={o} />}
                          {o.type === 'DEALER' && (
                            <div className="text-[11px] font-medium text-warning-fg">
                              Đại lý{o.dealerOnCredit === true ? ' · công nợ' : o.dealerOnCredit === false ? ' · trả trước' : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 font-semibold text-forest-700">{formatVnd(o.total)}</td>
                        <td className="hidden px-3 py-3 md:table-cell">
                          <OrderStatusBadge status={o.status} />
                        </td>
                        <td className="hidden px-3 py-3 text-xs text-stone-500 md:table-cell">
                          {formatDate(o.createdAt)}
                        </td>
                        <td className="hidden px-3 py-3 text-right md:table-cell">
                          <button
                            type="button"
                            aria-haspopup={narrow ? 'dialog' : undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(isExpanded ? null : (o.id || o.code));
                            }}
                            className={`${BTN_SMALL} inline-flex items-center gap-1 whitespace-nowrap`}
                          >
                            {isExpanded && !narrow ? 'Đóng' : 'Xem & Sửa'}
                            {isExpanded && !narrow ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && !narrow && (
                        <tr className="border-t border-stone-100 bg-stone-50">
                          <td colSpan={7} className="px-4 py-3">
                            <OrderDetailBody o={o} isAdmin={isAdmin} canFinance={canFinance} canWarehouse={canWarehouse} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      {narrow && expandedOrder && (
        <SideDrawer title={`Đơn ${expandedOrder.code}`} onClose={() => setExpandedId(null)}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <OrderStatusBadge status={expandedOrder.status} />
            <span className="font-semibold text-forest-700">{formatVnd(expandedOrder.total)}</span>
            <span className="text-xs text-stone-500">
              {PAYMENT_METHOD_LABELS[expandedOrder.paymentMethod] ?? expandedOrder.paymentMethod} · {formatDateTime(expandedOrder.createdAt)}
            </span>
          </div>
          <OrderDetailBody o={expandedOrder} isAdmin={isAdmin} canFinance={canFinance} canWarehouse={canWarehouse} />
        </SideDrawer>
      )}

      {/* Pagination Bar */}
      {q.data && totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 text-sm text-stone-600">
          <div>
            Tổng số: <span className="font-semibold text-stone-900">{q.data.meta.total}</span> đơn hàng
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className={BTN_SMALL}
            >
              ← Trang trước
            </button>
            <span className="text-xs">
              Trang <span className="font-semibold">{page}</span> / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className={BTN_SMALL}
            >
              Trang sau →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ô gọn tình trạng thanh toán ở dòng đơn; "Đang hoàn tiền" tô cảnh báo vì tiền chưa về khách. */
function PaymentStatusShort({ order: o }: { order: AdminOrder }) {
  const pending = isRefundInProgress(o, o.customerRefunds);
  return (
    <div data-payment-short className={`text-[11px] ${pending ? 'font-medium text-warning-fg' : 'text-stone-500'}`}>
      {orderPaymentStatusShort(o, o.customerRefunds)}
    </div>
  );
}

/** Đơn quà/đặt hộ: người nhận khác chủ tài khoản — hiện ra để kết quả tìm theo tên người nhận không trông như khớp nhầm. */
function OrderRecipientLine({ order: o }: { order: AdminOrder }) {
  const recipient = o.shippingAddress?.recipient?.trim();
  if (!recipient || recipient === o.user?.fullName?.trim()) return null;
  const phone = o.shippingAddress?.phone?.trim();
  return (
    <div data-order-recipient className="mt-0.5 break-words text-[11px] text-stone-500">
      Nhận: {recipient}
      {phone ? ` · ${phone}` : ''}
    </div>
  );
}

/** Chi tiết + thao tác một đơn — mở rộng trong bảng trên máy tính, trong ngăn kéo trên điện thoại. */
function OrderDetailBody({ o, isAdmin, canFinance, canWarehouse }: { o: AdminOrder; isAdmin: boolean; canFinance: boolean; canWarehouse: boolean }) {
  return (
    <div className="space-y-3">
      <OrderPaymentSummary order={o} isAdmin={isAdmin} />
      {canWarehouse && <PancakeAttentionPanel order={o} />}
      {canWarehouse && <PancakeSyncPanel order={o} />}

      {/* Order items */}
      <div>
        <div className="text-xs font-semibold uppercase text-stone-500">Sản phẩm trong đơn:</div>
        {o.items && o.items.length > 0 ? (
          <div className="mt-1 divide-y divide-stone-200 rounded-control border border-stone-200 bg-stone-0">
            {o.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <div>
                  <span className="font-medium text-stone-800">{it.productName}</span>
                  {it.variationName && <span className="text-stone-500"> ({it.variationName})</span>}
                  {!!it.backorderedQty && (
                    <span className="ml-2 rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-fg">
                      Đặt trước {it.backorderedQty}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-stone-500">{it.quantity} x {formatVnd(it.unitPrice)}</span>
                  <span className="ml-3 font-semibold text-stone-800">{formatVnd(it.total)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-500">Không có danh sách sản phẩm chi tiết.</p>
        )}
      </div>

      <OrderShippingAddress order={o} />

      {o.note && (
        <div className="text-xs text-stone-600">
          <span className="font-semibold">Ghi chú từ khách:</span> {o.note}
        </div>
      )}

      {(o.shippingCode || o.shippingStatus) && !o.hasRecyclingPickup && (
        <div className="text-xs text-stone-600">
          <span className="font-semibold">Vận chuyển:</span> {o.shippingPartner ?? ''} {o.shippingCode ?? ''}
          {o.shippingStatus ? ` · ${shippingStatusLabel(o.shippingStatus)}` : ''}
        </div>
      )}

      {canFinance && <OrderInvoicePanel order={o} />}
      {isAdmin && <OrderReferralPanel order={o} />}

      {canWarehouse && <RecyclingPanel order={o} />}

      {/* Đơn đại lý trả trước chờ chuyển khoản: admin xác nhận đã nhận tiền (tự ẩn khi không đủ điều kiện). */}
      {canFinance && <DealerPaymentPanel order={o} />}

      {/* Sổ công nợ đại lý (mọi đơn ĐẠI LÝ, không riêng đơn ghi công nợ) — A5-09. */}
      {canFinance && <DealerCreditPanel order={o} />}

      {/* Nút trạng thái + "Đã nhận tiền" theo allowedTransitions/canConfirmPayment của API (C-024). */}
      <OrderStatusActions order={o} canConfirmPayment={canFinance} canResync={isAdmin} canRecordLate={isAdmin} />

      <OrderStatusHistory order={o} />
    </div>
  );
}

type ReturnsFilter = 'REQUESTED' | 'TO_RECEIVE' | 'APPROVED' | 'REJECTED' | '';

const RETURNS_FILTER_LABELS: Record<ReturnsFilter, string> = {
  REQUESTED: 'Chờ duyệt',
  TO_RECEIVE: 'Chờ nhận hàng về',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  '': 'Tất cả trạng thái',
};

function ReturnsTab({
  canReview = true,
  canReceive = true,
  initialFilter = 'REQUESTED',
}: {
  canReview?: boolean;
  canReceive?: boolean;
  initialFilter?: ReturnsFilter;
}) {
  const [filter, setFilter] = useState<ReturnsFilter>(initialFilter);
  // Trước đây 1 trang (mặc định 20 của BE) và vứt meta → quá 20 yêu cầu thì các yêu cầu CŨ NHẤT (sát hạn
  // 7 ngày nhất) biến mất im lặng. Nay "Tải thêm" + hiện tổng.
  const oldestFirst = filter === 'REQUESTED' || filter === 'TO_RECEIVE';
  const q = useInfiniteQuery({
    queryKey: ['admin-returns', filter],
    queryFn: ({ pageParam }) =>
      listReturnRequests(filter || undefined, pageParam, undefined, oldestFirst ? 'asc' : undefined),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const pending = oldestFirst;
  const view = mergeQueuePages(q.data?.pages, pending);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          aria-label="Lọc yêu cầu đổi/trả theo trạng thái"
          value={filter}
          onChange={(e) => setFilter(e.target.value as ReturnsFilter)}
          className={`${FIELD_CLASS} ${TOUCH_H}`}
        >
          {(Object.keys(RETURNS_FILTER_LABELS) as ReturnsFilter[]).map((s) => (
            <option key={s} value={s}>
              {RETURNS_FILTER_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="text-xs text-stone-500">
          Khách trả theo dòng và số lượng. Duyệt: xem số tiền tính sẵn rồi xác nhận (hoàn tiền, đảo điểm/hoa hồng);
          kho chỉ cộng khi bấm &quot;Đã nhận hàng về&quot;.
        </span>
      </div>
      {q.data && (
        <p className="mt-2 text-xs text-stone-500">
          {view.label} yêu cầu{pending ? ' · cũ nhất trước' : ''}
        </p>
      )}
      <QueueMoreNotice pending={pending} view={view} noun="yêu cầu" />

      <div className="mt-3 space-y-3">
        {q.isError && <LoadError message="Không tải được danh sách yêu cầu đổi/trả." onRetry={() => void q.refetch()} />}
        {q.isLoading && <p className="text-sm text-stone-500">Đang tải danh sách yêu cầu…</p>}
        {view.items.map((r) => <ReturnRow key={r.id} item={r} canReview={canReview} canReceive={canReceive} />)}
        {q.data && view.items.length === 0 && <Empty>Không có yêu cầu đổi/trả nào.</Empty>}
      </div>
      <LoadMoreButton
        hasMore={view.hasMore}
        loading={q.isFetchingNextPage}
        onClick={() => void q.fetchNextPage()}
        error={q.isFetchNextPageError}
      />
    </div>
  );
}

const ROLES: UserRole[] = ['CUSTOMER', 'AFFILIATE', 'DEALER', 'STAFF', 'ADMIN'];

function UsersTab({ isAdmin = true }: { isAdmin?: boolean }) {
  // Trước đây gọi listUsers(1) CỐ ĐỊNH trang 1, không có UI phân trang — hệ thống có hơn 20
  // người dùng (limit mặc định của BE) thì phần còn lại vĩnh viễn không xem/không cấp quyền
  // được. Thêm page state + nút chuyển trang, mirror đúng pattern OrdersTab cùng file.
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['admin-users', page, search], queryFn: () => listUsers(page, search || undefined) });
  const totalPages = q.data ? Math.ceil(q.data.meta.total / q.data.meta.limit) : 1;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const narrow = useNarrowScreen();
  const { confirm, ask, dialog } = useConfirm();

  const exportAll = async () => {
    setMsg(null);
    setExporting(true);
    try {
      const r = await downloadUsersCsv(search || undefined);
      setMsg({ ok: true, text: `Đã tải ${r.filename} — mọi người dùng khớp tìm kiếm, không chỉ trang đang xem.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không xuất được CSV.' });
    } finally {
      setExporting(false);
    }
  };
  const onError = (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Thao tác thất bại.' });
  const block = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string; label: string }) => blockUser(id, reason),
    onSuccess: (_r, v) => {
      setMsg({ ok: true, text: `Đã khoá ${v.label}. Mọi phiên đăng nhập của người này đã bị thu hồi.` });
      void q.refetch();
    },
    onError,
  });
  const unblock = useMutation({
    mutationFn: ({ id }: { id: string; label: string }) => unblockUser(id),
    onSuccess: (_r, v) => {
      setMsg({ ok: true, text: `Đã mở khoá ${v.label}.` });
      void q.refetch();
    },
    onError,
  });

  const askBlock = async (u: AdminUser) => {
    setMsg(null);
    const label = u.fullName ?? u.phone ?? u.id;
    const reason = await ask({
      title: 'Khoá tài khoản',
      message: `Khoá ${label}${u.phone ? ` (${u.phone})` : ''}? Người này bị đăng xuất khỏi Mini App và web ngay, không đăng nhập lại được cho tới khi mở khoá.`,
      confirmLabel: 'Khoá tài khoản',
      tone: 'danger',
      input: { label: 'Lý do khoá', placeholder: 'VD: farm voucher nhiều tài khoản, bom hàng COD', required: true, maxLength: 500 },
    });
    if (reason === null) return;
    if (reason.length < 3) {
      setMsg({ ok: false, text: 'Lý do khoá cần ít nhất 3 ký tự.' });
      return;
    }
    block.mutate({ id: u.id, reason, label });
  };
  const askUnblock = async (u: AdminUser) => {
    setMsg(null);
    const label = u.fullName ?? u.phone ?? u.id;
    const ok = await confirm({
      title: 'Mở khoá tài khoản',
      message: `Mở khoá ${label}? Người này đăng nhập lại được ngay.`,
      confirmLabel: 'Mở khoá',
    });
    if (ok) unblock.mutate({ id: u.id, label });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-stone-900">Quản lý người dùng & phân quyền</h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => void exportAll()}
            disabled={exporting || !q.data || q.data.meta.total === 0}
            className={`${BTN_SECONDARY} flex items-center gap-1.5`}
            title="Xuất mọi người dùng khớp tìm kiếm ra file CSV"
          >
            <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
            {exporting ? 'Đang xuất…' : 'Xuất CSV người dùng'}
          </button>
        )}
      </div>
      {isAdmin && <GrantRoleForm onDone={() => q.refetch()} />}
      <form
        role="search"
        aria-label="Tìm người dùng"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          type="search"
          aria-label="Tìm theo SĐT, tên hoặc mã người dùng"
          placeholder="Tìm theo SĐT, tên hoặc mã người dùng…"
          maxLength={100}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className={`${FIELD_CLASS} ${TOUCH_H} min-w-0 flex-1`}
        />
        <button type="submit" className={`${BTN_PRIMARY} whitespace-nowrap`}>
          Tìm kiếm
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setPage(1);
            }}
            className={`${BTN_SECONDARY} whitespace-nowrap`}
          >
            Xóa lọc
          </button>
        )}
      </form>
      {msg && (
        <p role="status" className={`text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</p>
      )}
      {q.isError ? (
        <LoadError message="Không tải được danh sách người dùng." onRetry={() => void q.refetch()} />
      ) : (
        <>
          <UsersList
            users={q.data?.data ?? []}
            isAdmin={isAdmin}
            narrow={narrow}
            blockBusy={block.isPending}
            unblockBusy={unblock.isPending}
            onOpenDetail={setDetailId}
            onBlock={askBlock}
            onUnblock={askUnblock}
          />
          {q.data && q.data.data.length === 0 && (
            <p className="text-sm text-stone-500">
              {search ? `Không có người dùng nào khớp “${search}”.` : 'Chưa có người dùng nào.'}
            </p>
          )}

          {q.data && totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 text-sm text-stone-600">
              <div>
                Tổng số: <span className="font-semibold text-stone-900">{q.data.meta.total}</span> người dùng
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className={BTN_SMALL}
                >
                  ← Trang trước
                </button>
                <span className="text-xs">
                  Trang <span className="font-semibold">{page}</span> / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className={BTN_SMALL}
                >
                  Trang sau →
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {dialog}
      {detailId && <UserDetailDrawer userId={detailId} isAdmin={isAdmin} onClose={() => setDetailId(null)} />}
    </div>
  );
}

const roleLabel = (r: string) => USER_ROLE_LABELS[r] ?? r;

/**
 * Hậu quả đổi vai trò, bám admin.service: nhóm việc chỉ giữ khi đích là STAFF; cờ đối tác chỉ tắt khi đích là CUSTOMER/AFFILIATE
 * (kể cả nhân viên/admin đang sở hữu gian hàng đối tác). `current` là vai trò hiện tại tra được theo SĐT; chưa tra được thì nêu dạng điều kiện.
 */
function roleChangeConsequences(target: UserRole, current?: string | null): string {
  const lines: string[] = [];
  if (current) lines.push(`Hiện là ${roleLabel(current)} → đổi sang ${roleLabel(target)}.`);
  if (target !== 'STAFF' && (!current || current === 'STAFF')) {
    lines.push(`${current ? 'Tài khoản này sẽ mất' : 'Nếu tài khoản đang là nhân viên: mất'} toàn bộ nhóm việc, đặt lại nhân viên không trả nhóm việc cũ.`);
  } else if (target === 'STAFF' && !current) {
    lines.push('Nếu tài khoản đã là nhân viên: giữ nguyên nhóm việc hiện có.');
  }
  if (target !== 'ADMIN' && (!current || current === 'ADMIN')) {
    lines.push(`${current ? 'Tài khoản này sẽ mất' : 'Nếu tài khoản đang là Quản trị: mất'} toàn quyền quản trị.`);
  }
  if (target === 'CUSTOMER' || target === 'AFFILIATE') {
    lines.push(
      'Nếu tài khoản sở hữu gian hàng đối tác (đại lý, nhân viên hoặc admin): gian hàng bị tắt cờ đối tác; gian hàng MERCHANT chuyển về CTV.',
    );
  } else if (target === 'DEALER' && (!current || current === 'DEALER')) {
    lines.push(`${current ? 'Tài khoản đã là đại lý' : 'Nếu tài khoản đã là đại lý'}: chỉ đổi bậc, gian hàng đối tác giữ nguyên.`);
  }
  return lines.join('\n');
}

const phoneKey = (v: string) => v.replace(/\D/g, '').replace(/^84/, '0');

/** Vai trò hiện tại của SĐT (khớp đúng số, không khớp một phần); không tra được thì null để hộp xác nhận nêu hậu quả dạng điều kiện. */
async function lookupRoleByPhone(phone: string): Promise<string | null> {
  try {
    const key = phoneKey(phone);
    const res = await listUsers(1, phone.trim());
    return res.data.find((u) => u.phone && phoneKey(u.phone) === key)?.role ?? null;
  } catch {
    return null;
  }
}

/** Cấp/đổi vai trò theo SĐT — thay script SSH grant-admin.js (có guard @Roles + log ai đổi). */
function GrantRoleForm({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  // Không đặt vai trò mặc định: bất kỳ giá trị nào cũng là một lần đổi vai trò, và CUSTOMER còn gỡ
  // nhóm việc của nhân viên, tắt cờ đối tác của đại lý. Admin phải chọn có chủ đích.
  const [role, setRole] = useState<UserRole | ''>('');
  // DEALER bắt buộc kèm bậc (BE từ chối nếu thiếu — C-008): đại lý không bậc đặt CREDIT không bị chặn hạn mức.
  const [tierId, setTierId] = useState('');
  const needsTier = role === 'DEALER';
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const { confirm, dialog } = useConfirm();
  const mut = useMutation({
    mutationFn: (v: { phone: string; role: UserRole; tierId?: string }) => setUserRole(v.phone, v.role, v.tierId),
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Đã đổi ${r.phone ?? r.id}: ${roleLabel(r.previousRole)} → ${roleLabel(r.role)}` });
      setPhone('');
      setRole('');
      setTierId('');
      onDone();
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi cấp quyền' }),
  });
  const submit = async () => {
    setMsg(null);
    if (!role) return;
    // Chụp giá trị lúc bấm: hộp xác nhận và lệnh đổi phải nói về cùng một SĐT dù ô nhập có bị sửa giữa chừng.
    const target = { phone: phone.trim(), role, tierId: needsTier ? tierId : undefined };
    setChecking(true);
    const current = await lookupRoleByPhone(target.phone);
    setChecking(false);
    const ok = await confirm(
      role === 'ADMIN'
        ? {
            title: 'Cấp quyền ADMIN',
            message: `Cấp quyền ADMIN (toàn quyền quản trị) cho SĐT ${target.phone}?`,
            confirmLabel: 'Cấp quyền ADMIN',
            tone: 'danger',
          }
        : {
            title: 'Đổi vai trò',
            message: `Đổi vai trò của SĐT ${target.phone} sang "${roleLabel(target.role)}"?\n${roleChangeConsequences(target.role, current)}`,
            confirmLabel: 'Đổi vai trò',
            tone: 'danger',
          },
    );
    if (!ok) return;
    mut.mutate(target);
  };
  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-4">
      <h3 className="mb-2 font-display text-sm font-semibold text-stone-900">Cấp / đổi vai trò theo SĐT</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-auto">
          <Field label="SĐT cần cấp quyền (đã mở Mini App)">
            <input
              className={`${FIELD_CLASS} ${TOUCH_H} w-full sm:w-auto`}
              placeholder="SĐT, vd 0912345678"
              value={phone}
              disabled={checking}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Vai trò cần cấp">
          <select
            aria-label="Vai trò cần cấp"
            className={`${FIELD_CLASS} ${TOUCH_H}`}
            value={role}
            disabled={checking}
            onChange={(e) => setRole(e.target.value as UserRole | '')}
          >
            <option value="">Chọn vai trò…</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{USER_ROLE_LABELS[r] ?? r}</option>
            ))}
          </select>
        </Field>
        {needsTier && <DealerTierSelect value={tierId} onChange={setTierId} className="min-w-0 flex-1" />}
        <button
          className={BTN_PRIMARY}
          disabled={!phone.trim() || !role || (needsTier && !tierId.trim()) || mut.isPending || checking}
          title={needsTier && !tierId.trim() ? 'Cần chọn bậc đại lý để cấp vai trò DEALER' : undefined}
          onClick={submit}
        >
          {mut.isPending ? 'Đang lưu…' : 'Cấp quyền'}
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</p>
      )}
      {dialog}
    </div>
  );
}

/** Bỏ dấu, hoa/thường để ô tìm khớp "phi giao" với "Phí giao". `đ`/`Đ` không tách dấu được nên đổi tay, trước khi hạ chữ thường. */
const foldSearch = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const CONFIG_OTHER_GROUP = 'Khác';

/** Nhóm theo tiền tố trước dấu chấm đầu tiên (`affiliate.`, `loyalty.`…); khoá không có tiền tố gom vào "Khác", đứng cuối. */
function groupConfigRows(rows: ConfigRow[]): { name: string; rows: ConfigRow[] }[] {
  const byName = new Map<string, ConfigRow[]>();
  for (const r of rows) {
    const name = r.key.includes('.') ? r.key.slice(0, r.key.indexOf('.')) : CONFIG_OTHER_GROUP;
    byName.set(name, [...(byName.get(name) ?? []), r]);
  }
  const groups = [...byName].map(([name, list]) => ({ name, rows: list }));
  return [...groups.filter((g) => g.name !== CONFIG_OTHER_GROUP), ...groups.filter((g) => g.name === CONFIG_OTHER_GROUP)];
}

function ConfigTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-config'], queryFn: () => getConfig() });
  const [search, setSearch] = useState('');
  const needle = foldSearch(search.trim());
  const matches = (c: ConfigRow) => !needle || foldSearch(`${c.key} ${c.description ?? ''}`).includes(needle);
  const groups = groupConfigRows(q.data ?? []);
  const shownCount = (q.data ?? []).filter(matches).length;
  if (q.isError) return <LoadError message="Không tải được danh sách cấu hình." onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-4">
      <GomdonConfigCard rows={q.data} />
      <LoyaltyConfigCard rows={q.data} />
      <div>
        <h2 className="font-display text-sm font-semibold text-stone-900">Tất cả tham số (JSON)</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Giá trị có tên chứa password/secret/token luôn hiện dạng ••••••••; giữ nguyên chuỗi đó khi lưu thì giá trị thật không đổi.
        </p>
        <input
          type="search"
          aria-label="Tìm khoá cấu hình"
          placeholder="Tìm theo khoá hoặc mô tả, vd affiliate"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${INPUT_CLASS} ${TOUCH_H} mt-2 max-w-md`}
        />
        <div className="mt-3 space-y-4">
          {groups.map((g) => (
            <section key={g.name} hidden={!g.rows.some(matches)} className="space-y-2">
              <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-stone-600">
                {g.name} ({g.rows.filter(matches).length})
              </h3>
              {g.rows.map((c) => (
                // Ẩn bằng hidden thay vì gỡ khỏi cây: JSON đang sửa dở nằm trong state của ConfigItem, gỡ ra là mất.
                <div key={`${c.key}:${JSON.stringify(c.value)}`} hidden={!matches(c)}>
                  <ConfigItem row={c} onSaved={() => qc.invalidateQueries({ queryKey: ['admin-config'] })} />
                </div>
              ))}
            </section>
          ))}
          {needle && shownCount === 0 && <p className="text-sm text-stone-500">Không có khoá nào khớp &quot;{search.trim()}&quot;.</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * `<input type="date">` trả "2026-09-30". `new Date("2026-09-30")` được JS hiểu theo UTC, tức
 * 07:00 sáng giờ VN — voucher "đến hết 30/9" chết từ 7h sáng 30/9, còn voucher "từ 1/10" không
 * dùng được suốt 7 tiếng đầu ngày. Ghép giờ địa phương trước khi dựng Date để mốc đúng ý admin.
 */
function localDateIso(dayKey: string, endOfDay: boolean, fallbackMs: number): string {
  if (!dayKey) return new Date(fallbackMs).toISOString();
  return new Date(`${dayKey}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString();
}

function CouponsTab() {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: '',
    type: 'PERCENT',
    value: 10,
    startAt: '',
    endAt: '',
    scope: 'PUBLIC',
    minOrder: '',
    maxDiscount: '',
    usageLimit: '',
    perUserLimit: '1',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const create = useMutation({
    mutationFn: () =>
      createCoupon({
        code: f.code,
        type: f.type as 'PERCENT' | 'AMOUNT' | 'FREESHIP',
        value: Number(f.value),
        // BE coi các trường này thiếu = KHÔNG GIỚI HẠN: một mã PERCENT 30 không trần giảm và
        // không giới hạn lượt dùng nghĩa là đơn 10 triệu được giảm 3 triệu, lặp lại bao nhiêu
        // lần cũng được. Form cũ không thu bốn trường này nên mọi voucher tạo từ web đều vậy.
        minOrder: num(f.minOrder),
        maxDiscount: num(f.maxDiscount),
        usageLimit: num(f.usageLimit),
        perUserLimit: num(f.perUserLimit),
        startAt: localDateIso(f.startAt, false, Date.now()),
        endAt: localDateIso(f.endAt, true, Date.now() + 30 * 864e5),
        scope: f.scope as 'PUBLIC',
      }),
    onSuccess: () => {
      setMsg('Đã tạo voucher!');
      void qc.invalidateQueries({ queryKey: ['admin-coupons'] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'Lỗi'),
  });
  const field = `${INPUT_CLASS} ${TOUCH_H}`;
  return (
    <div className="space-y-6">
    <div className="max-w-md space-y-2" data-testid="coupon-create-form">
      <Field label="Mã voucher">
        <input
          placeholder="Mã (vd WELCOME30)"
          aria-label="Mã voucher"
          value={f.code}
          // Khách luôn nhập mã dạng HOA không khoảng trắng (Mini App/web tự đổi): lưu đúng dạng đó.
          onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
          className={field}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Field label="Loại voucher">
          <select aria-label="Loại voucher" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={`${FIELD_CLASS} ${TOUCH_H}`}>
            <option value="PERCENT">% giảm</option>
            <option value="AMOUNT">Giảm tiền</option>
            <option value="FREESHIP">Freeship</option>
          </select>
        </Field>
        <Field label="Giá trị">
          <input type="number" placeholder="Giá trị" value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} className={`${FIELD_CLASS} ${TOUCH_H} w-28`} />
        </Field>
      </div>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Đơn tối thiểu (đ)">
            <input type="number" placeholder="Đơn tối thiểu (đ)" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} className={field} />
          </Field>
        </div>
        <div className="min-w-0 flex-1">
          <Field label="Giảm tối đa (đ)">
            <input type="number" placeholder="Giảm tối đa (đ)" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} className={field} />
          </Field>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Tổng lượt dùng">
            <input type="number" placeholder="Tổng lượt dùng" value={f.usageLimit} onChange={(e) => setF({ ...f, usageLimit: e.target.value })} className={field} />
          </Field>
        </div>
        <div className="min-w-0 flex-1">
          <Field label="Lượt / khách">
            <input type="number" placeholder="Lượt / khách" value={f.perUserLimit} onChange={(e) => setF({ ...f, perUserLimit: e.target.value })} className={field} />
          </Field>
        </div>
      </div>
      <p className="text-xs text-stone-500">
        Bỏ trống = không giới hạn. Mã % nên đặt &quot;Giảm tối đa&quot; để đơn lớn không bị giảm quá tay.
      </p>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Bắt đầu từ ngày">
            <input type="date" aria-label="Voucher bắt đầu từ ngày" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} className={field} />
          </Field>
        </div>
        <div className="min-w-0 flex-1">
          <Field label="Hết hạn ngày">
            <input type="date" aria-label="Voucher hết hạn ngày" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} className={field} />
          </Field>
        </div>
      </div>
      <button onClick={() => create.mutate()} disabled={!f.code} className={`${BTN_PRIMARY} w-full`}>Tạo voucher</button>
      {msg && <p className={`text-sm ${create.isError ? 'text-danger-fg' : 'text-success-fg'}`}>{msg}</p>}
    </div>
    <ClaimCampaignPanel />
    <CouponList />
    </div>
  );
}

const CARD_CLASS = 'rounded-card border border-stone-200 bg-stone-0 p-4';
// Hàng con trong thẻ (sản phẩm của nhãn, khuyến mãi, chương trình đại lý...): tên co/ngắt dòng được để nút chữ bên phải không bị đẩy ra ngoài ở 390px.
const LIST_ITEM_CLASS = 'flex items-center justify-between gap-2 rounded-control border border-stone-200 px-2 py-1 text-sm';

function BrandsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-brands'], queryFn: listBrands });
  const [form, setForm] = useState({ name: '', tagline: '' });
  const create = useMutation({
    mutationFn: () => createBrand({ name: form.name.trim(), tagline: form.tagline.trim() || undefined }),
    onSuccess: () => { setForm({ name: '', tagline: '' }); void qc.invalidateQueries({ queryKey: ['admin-brands'] }); },
  });
  const cell = 'grow basis-full sm:basis-48';
  const field = `${INPUT_CLASS} ${TOUCH_H}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-card border border-stone-200 bg-stone-0 p-3">
        <div className={cell}>
          <Field label="Tên nhãn">
            <input placeholder="Tên nhãn (vd Dừa Bến Tre)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
          </Field>
        </div>
        <div className={cell}>
          <Field label="Tagline (câu giới thiệu ngắn)">
            <input placeholder="Tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} className={field} />
          </Field>
        </div>
        <button onClick={() => create.mutate()} disabled={!form.name.trim() || create.isPending} className={BTN_PRIMARY}>Tạo nhãn</button>
      </div>
      {create.isError && <p className="text-sm text-danger-fg">{(create.error as Error).message}</p>}

      <div className="space-y-3">
        {q.isError && <LoadError message="Không tải được danh sách nhãn hàng." onRetry={() => void q.refetch()} />}
        {q.data?.map((b) => <BrandRow key={b.id} brand={b} />)}
        {q.data?.length === 0 && <Empty>Chưa có nhãn hàng. Tạo nhãn đầu tiên ở trên.</Empty>}
      </div>

      <DealerRewardsSection />
    </div>
  );
}

function BrandRow({ brand }: { brand: AdminBrand }) {
  const { askDelete, dialog } = useDeleteConfirm();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refreshBrands = () => qc.invalidateQueries({ queryKey: ['admin-brands'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const onRowError = (e: unknown) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại.');
  const patch = useMutation({
    mutationFn: (body: Partial<{ isPublished: boolean }>) => updateBrand(brand.id, body),
    onSuccess: () => { setRowErr(null); refreshBrands(); },
    onError: onRowError,
  });
  const verify = useMutation({
    mutationFn: (v: boolean) => verifyBrand(brand.id, v),
    onSuccess: () => { setRowErr(null); refreshBrands(); },
    onError: onRowError,
  });
  const [owner, setOwner] = useState<PickedItem | null>(null);
  const assignOwner = useMutation({
    mutationFn: () => updateBrand(brand.id, { ownerUserId: owner?.id ?? '' }),
    onSuccess: () => { setOwner(null); refreshBrands(); },
  });
  const products = useQuery({ queryKey: ['admin-brand-products', brand.id], queryFn: () => listBrandProducts(brand.id), enabled: open });
  const promos = useQuery({ queryKey: ['admin-brand-promos', brand.id], queryFn: () => listPromotions(brand.id), enabled: open });
  const link = useMutation({
    mutationFn: () => linkBrandByName(brand.id),
    onSuccess: () => { setRowErr(null); qc.invalidateQueries({ queryKey: ['admin-brand-products', brand.id] }); },
    onError: onRowError,
  });
  const detach = useMutation({
    mutationFn: (pid: string) => detachBrandProducts(brand.id, [pid]),
    onSuccess: () => { setRowErr(null); qc.invalidateQueries({ queryKey: ['admin-brand-products', brand.id] }); },
    onError: onRowError,
  });
  const [promo, setPromo] = useState({ title: '', subtitle: '', startAt: '', endAt: '' });
  const addPromo = useMutation({
    mutationFn: () => createPromotion(brand.id, {
      title: promo.title.trim(), subtitle: promo.subtitle.trim() || undefined,
      // Cùng lỗi múi giờ với voucher — xem localDateIso.
      startAt: localDateIso(promo.startAt, false, Date.now()),
      endAt: localDateIso(promo.endAt, true, Date.now() + 30 * 864e5),
    }),
    onSuccess: () => { setPromo({ title: '', subtitle: '', startAt: '', endAt: '' }); void qc.invalidateQueries({ queryKey: ['admin-brand-promos', brand.id] }); },
  });
  const delPromo = useMutation({
    mutationFn: (pid: string) => deletePromotion(pid),
    onSuccess: () => { setRowErr(null); qc.invalidateQueries({ queryKey: ['admin-brand-promos', brand.id] }); },
    onError: onRowError,
  });
  const cell = 'grow basis-full sm:basis-40';
  const grow = `${INPUT_CLASS} ${TOUCH_H}`;
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium text-stone-900">
            {brand.name}
            {brand.isVerified && <ToneBadge tone="success"><Check className="h-3 w-3" aria-hidden />Chính hãng</ToneBadge>}
            {!brand.isPublished && <ToneBadge tone="neutral">Nháp</ToneBadge>}
          </div>
          <div className="break-words text-xs text-stone-500">/{brand.slug} · {brand.followerCount} theo dõi</div>
        </div>
        <button onClick={() => setOpen((o) => !o)} className={`${BTN_LINK} shrink-0 text-sm`}>{open ? 'Thu gọn' : 'Quản lý'}</button>
      </div>

      {open && (
        <div className="mt-3 space-y-4 border-t border-stone-200 pt-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => patch.mutate({ isPublished: !brand.isPublished })} className={BTN_SECONDARY}>
              {brand.isPublished ? 'Ẩn (chuyển nháp)' : 'Đăng (publish)'}
            </button>
            <button onClick={() => verify.mutate(!brand.isVerified)} className={`${BTN_SECONDARY} inline-flex items-center gap-1`}>
              {brand.isVerified ? 'Bỏ chính hãng' : <>Cấp <Check className="h-4 w-4" aria-hidden /> chính hãng</>}
            </button>
            <button onClick={() => link.mutate()} disabled={link.isPending} className={BTN_PRIMARY}>
              Gán SP theo tên nhãn
            </button>
            {link.data && <span className="self-center text-sm text-success-fg">Đã gán {link.data.linked} SP</span>}
          </div>
          {rowErr && <p className="text-xs text-danger-fg">{rowErr}</p>}

          {/* Gán chủ nhãn (lộ trình B) — đối tác tự quản nhãn trong Mini App */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-stone-500">Chủ nhãn:</span>
            <UserPicker value={owner} onChange={setOwner} label="Chọn đối tác làm chủ nhãn" className="min-w-[12rem] flex-1" />
            <button onClick={() => assignOwner.mutate()} disabled={!owner || assignOwner.isPending} className={BTN_SECONDARY}>
              Gán chủ nhãn
            </button>
            {assignOwner.isSuccess && <span className="inline-flex items-center gap-1 text-success-fg">Đã gán <Check className="h-4 w-4" aria-hidden /></span>}
            {assignOwner.isError && <span className="text-danger-fg">{(assignOwner.error as Error).message}</span>}
          </div>

          <BrandInfoForm brand={brand} />

          <div>
            <div className="mb-1 text-sm font-medium text-stone-900">Sản phẩm ({products.data?.length ?? 0})</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {products.data?.map((p) => (
                <div key={p.id} className={LIST_ITEM_CLASS}>
                  <span className="min-w-0 truncate">{p.name}</span>
                  <button
                    onClick={() => askDelete({
                      title: 'Gỡ sản phẩm khỏi nhãn',
                      message: `Gỡ "${p.name}" khỏi nhãn ${brand.name}? Sản phẩm không còn thuộc nhãn này cho tới khi gán lại.`,
                      confirmLabel: 'Gỡ sản phẩm',
                    }, () => detach.mutate(p.id))}
                    className={`${BTN_LINK_DANGER} shrink-0 text-xs`}
                  >Gỡ</button>
                </div>
              ))}
              {products.data?.length === 0 && <p className="text-xs text-stone-500">Chưa có SP. Bấm “Gán SP theo tên nhãn” để liên kết catalog.</p>}
            </div>
          </div>

          <div>
            <div className="mb-1 text-sm font-medium text-stone-900">Khuyến mãi</div>
            <div className="space-y-1">
              {promos.data?.map((pm) => (
                <div key={pm.id} className={LIST_ITEM_CLASS}>
                  <span className="min-w-0 break-words">{pm.title}{pm.subtitle ? ` · ${pm.subtitle}` : ''}</span>
                  <button
                    onClick={() => askDelete({
                      title: 'Xoá khuyến mãi',
                      message: `Xoá khuyến mãi "${pm.title}" của nhãn ${brand.name}? Không hoàn tác được.`,
                      confirmLabel: 'Xoá khuyến mãi',
                    }, () => delPromo.mutate(pm.id))}
                    className={`${BTN_LINK_DANGER} shrink-0 text-xs`}
                  >Xoá</button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className={cell}>
                <Field label="Tiêu đề khuyến mãi">
                  <input placeholder="Tiêu đề (MUA 2 TẶNG 1)" value={promo.title} onChange={(e) => setPromo({ ...promo, title: e.target.value })} className={grow} />
                </Field>
              </div>
              <div className={cell}>
                <Field label="Mô tả">
                  <input placeholder="Mô tả" value={promo.subtitle} onChange={(e) => setPromo({ ...promo, subtitle: e.target.value })} className={grow} />
                </Field>
              </div>
              <Field label="Bắt đầu từ ngày">
                <input type="date" aria-label="Khuyến mãi bắt đầu từ ngày" value={promo.startAt} onChange={(e) => setPromo({ ...promo, startAt: e.target.value })} className={field} />
              </Field>
              <Field label="Kết thúc ngày">
                <input type="date" aria-label="Khuyến mãi kết thúc ngày" value={promo.endAt} onChange={(e) => setPromo({ ...promo, endAt: e.target.value })} className={field} />
              </Field>
              <button onClick={() => addPromo.mutate()} disabled={!promo.title.trim()} className={BTN_PRIMARY}>Thêm KM</button>
            </div>
            {addPromo.isError && <p className="mt-1 text-xs text-danger-fg">{(addPromo.error as Error).message}</p>}
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}

function BrandInfoForm({ brand }: { brand: AdminBrand }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    logoUrl: brand.logoUrl ?? '',
    coverUrl: brand.coverUrl ?? '',
    tagline: brand.tagline ?? '',
    origin: brand.origin ?? '',
    story: brand.story ?? '',
  });
  const [certs, setCerts] = useState<BrandCert[]>(brand.certifications ?? []);
  const save = useMutation({
    mutationFn: () =>
      updateBrand(brand.id, {
        logoUrl: f.logoUrl.trim(),
        coverUrl: f.coverUrl.trim(),
        tagline: f.tagline.trim(),
        origin: f.origin.trim(),
        story: f.story.trim(),
        certifications: certs.filter((c) => c.code.trim() && c.label.trim()),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-brands'] }),
  });

  const setCert = (i: number, patch: Partial<BrandCert>) =>
    setCerts((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const input = `${INPUT_CLASS} ${TOUCH_H}`;
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className="rounded-card border border-stone-200 bg-stone-50 p-3">
      <div className="mb-2 font-display text-sm font-medium text-stone-900">Thông tin nhãn</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Logo (URL)">
          <input placeholder="Logo URL" value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} className={input} />
        </Field>
        <Field label="Ảnh bìa (URL)">
          <input placeholder="Ảnh bìa (URL)" value={f.coverUrl} onChange={(e) => setF({ ...f, coverUrl: e.target.value })} className={input} />
        </Field>
        <Field label="Tagline">
          <input placeholder="Tagline" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} className={input} />
        </Field>
        <Field label="Nguồn gốc">
          <input placeholder="Nguồn gốc (vd Bến Tre)" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} className={input} />
        </Field>
      </div>
      <div className="mt-2">
        <Field label="Câu chuyện thương hiệu">
          <textarea placeholder="Câu chuyện thương hiệu" value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} rows={3} className={INPUT_CLASS} />
        </Field>
      </div>

      <div className="mt-3 text-sm font-medium text-stone-900">
        Chứng nhận (chỉ cái <Check className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden /> đã xác minh mới hiện cho khách)
      </div>
      <div className="space-y-1">
        {certs.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <input placeholder="Mã (ORG)" aria-label={`Mã chứng nhận ${i + 1}`} value={c.code} onChange={(e) => setCert(i, { code: e.target.value })} className={`${field} w-24`} />
            <input placeholder="Nhãn (Hữu cơ USDA)" aria-label={`Tên chứng nhận ${i + 1}`} value={c.label} onChange={(e) => setCert(i, { label: e.target.value })} className={`${field} grow basis-40`} />
            <input placeholder="Proof URL" aria-label={`Link bằng chứng chứng nhận ${i + 1}`} value={c.proofUrl ?? ''} onChange={(e) => setCert(i, { proofUrl: e.target.value })} className={`${field} w-40`} />
            <label className="inline-flex min-h-[44px] items-center gap-1.5 text-stone-700 sm:min-h-0">
              <input type="checkbox" className="h-4 w-4 accent-forest-600" checked={c.verified ?? false} onChange={(e) => setCert(i, { verified: e.target.checked })} />
              <Check className="h-4 w-4" aria-hidden /> verified
            </label>
            <button onClick={() => setCerts((cs) => cs.filter((_, idx) => idx !== i))} className={`${BTN_LINK_DANGER} text-xs`}>Xoá</button>
          </div>
        ))}
      </div>
      <button onClick={() => setCerts((cs) => [...cs, { code: '', label: '', verified: false }])} className={`${BTN_LINK} mt-1 text-sm`}>+ Thêm chứng nhận</button>

      <div className="mt-2">
        <button onClick={() => save.mutate()} disabled={save.isPending} className={BTN_PRIMARY}>Lưu thông tin</button>
        {save.isSuccess && <span className="ml-2 inline-flex items-center gap-1 text-sm text-success-fg">Đã lưu <Check className="h-4 w-4" aria-hidden /></span>}
        {save.isError && <span className="ml-2 text-sm text-danger-fg">{(save.error as Error).message}</span>}
      </div>
    </div>
  );
}

const REWARD_TYPE_LABELS: Record<string, string> = { TOUR: 'Tour', GIFT: 'Quà', OTHER: 'Khác' };

function DealerRewardsSection() {
  const { askDelete, dialog } = useDeleteConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-dealer-rewards'], queryFn: listDealerRewards });
  const [f, setF] = useState({ type: 'TOUR', title: '', description: '', threshold: 50000000, period: 'QUARTER' });
  const create = useMutation({
    mutationFn: () => createDealerReward({
      type: f.type as 'TOUR' | 'GIFT' | 'OTHER', title: f.title.trim(),
      description: f.description.trim() || undefined, threshold: Number(f.threshold), period: f.period,
    }),
    onSuccess: () => { setF({ type: 'TOUR', title: '', description: '', threshold: 50000000, period: 'QUARTER' }); void qc.invalidateQueries({ queryKey: ['admin-dealer-rewards'] }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteDealerReward(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-dealer-rewards'] }),
  });
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className={CARD_CLASS}>
      <div className="mb-2 flex items-center gap-1.5 font-display font-medium text-stone-900"><Store className="h-4 w-4 text-forest-700" aria-hidden />Chương trình đại lý (thưởng doanh số)</div>
      <div className="space-y-1">
        {q.isError && <LoadError message="Không tải được danh sách chương trình." onRetry={() => void q.refetch()} />}
        {q.data?.map((d) => (
          <div key={d.id} className={LIST_ITEM_CLASS}>
            <span className="min-w-0 break-words">{REWARD_TYPE_LABELS[d.type] ?? d.type} · {d.title} · mốc {formatVnd(d.threshold)}/{d.period === 'YEAR' ? 'năm' : 'quý'}{d.brandId ? '' : ' · toàn shop'}</span>
            <button
              onClick={() => askDelete({
                title: 'Xoá chương trình thưởng đại lý',
                message: `Xoá chương trình "${d.title}"? Các yêu cầu nhận thưởng đã gửi trước đó sẽ mất liên kết với chương trình này, không hoàn tác được.`,
                confirmLabel: 'Xoá chương trình',
              }, () => del.mutate(d.id))}
              className={`${BTN_LINK_DANGER} shrink-0 text-xs`}
            >Xoá</button>
          </div>
        ))}
        {q.data?.length === 0 && <p className="text-xs text-stone-500">Chưa có chương trình.</p>}
        {del.isError && <p className="text-xs text-danger-fg">{(del.error as Error).message}</p>}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Field label="Loại phần thưởng">
          <select aria-label="Loại phần thưởng" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={field}>
            {Object.entries(REWARD_TYPE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Kỳ tính doanh số">
          <select aria-label="Kỳ tính doanh số" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} className={field}>
            <option value="QUARTER">Theo quý</option>
            <option value="YEAR">Theo năm</option>
          </select>
        </Field>
        <div className="grow basis-full sm:basis-48">
          <Field label="Tiêu đề chương trình">
            <input placeholder="Tiêu đề (Tour Phú Quốc)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={`${field} w-full`} />
          </Field>
        </div>
        <Field label="Mốc doanh số (đ)">
          <input type="number" placeholder="Mốc doanh số" value={f.threshold} onChange={(e) => setF({ ...f, threshold: Number(e.target.value) })} className={`${field} w-36`} />
        </Field>
        <button onClick={() => create.mutate()} disabled={!f.title.trim()} className={BTN_PRIMARY}>Thêm</button>
      </div>
      {create.isError && <p className="mt-1 text-xs text-danger-fg">{(create.error as Error).message}</p>}
      {dialog}
    </div>
  );
}

function FlashSalesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-flash-sales'], queryFn: listFlashSales });
  const [f, setF] = useState({ title: '', startAt: '', endAt: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createFlashSale({
        title: f.title.trim(),
        startAt: new Date(f.startAt).toISOString(),
        endAt: new Date(f.endAt).toISOString(),
      }),
    onSuccess: () => {
      setF({ title: '', startAt: '', endAt: '' });
      setMsg({ ok: true, text: 'Đã tạo đợt flash sale!' });
      void qc.invalidateQueries({ queryKey: ['admin-flash-sales'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi tạo đợt flash sale' }),
  });
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className="space-y-4">
      <div className={CARD_CLASS}>
        <h2 className="mb-2 font-display text-sm font-semibold text-stone-900">Tạo đợt Flash Sale</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow basis-full sm:basis-48">
            <Field label="Tên đợt">
              <input
                placeholder="vd Flash Sale cuối tuần"
                value={f.title}
                onChange={(e) => setF({ ...f, title: e.target.value })}
                className={`${field} w-full`}
              />
            </Field>
          </div>
          <Field label="Bắt đầu lúc">
            <input type="datetime-local" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} className={field} />
          </Field>
          <Field label="Kết thúc lúc">
            <input type="datetime-local" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} className={field} />
          </Field>
          <button
            onClick={() => { setMsg(null); create.mutate(); }}
            disabled={!f.title.trim() || !f.startAt || !f.endAt || create.isPending}
            className={BTN_PRIMARY}
          >
            {create.isPending ? 'Đang tạo…' : 'Tạo đợt'}
          </button>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</p>}
      </div>

      <div className="space-y-3">
        {q.isError && <LoadError message="Không tải được danh sách flash sale." onRetry={() => void q.refetch()} />}
        {q.data?.map((s) => <FlashSaleRow key={s.id} sale={s} />)}
        {q.data?.length === 0 && <Empty>Chưa có đợt flash sale nào. Tạo đợt đầu tiên ở trên.</Empty>}
      </div>
    </div>
  );
}

/** Giá trị cho `<input type="datetime-local">` (giờ máy admin), cùng cách đọc với lúc tạo đợt: `new Date(value)`. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const EMPTY_ITEM = { variationId: '', flashPrice: '', quota: '', perUserLimit: '' };

function FlashSaleRow({ sale }: { sale: AdminFlashSale }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-flash-sales'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const toggleActive = useMutation({
    mutationFn: () => updateFlashSale(sale.id, { isActive: !sale.isActive }),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: (e) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra'),
  });
  const delItem = useMutation({
    mutationFn: (itemId: string) => deleteFlashSaleItem(itemId),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: (e) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra'),
  });
  const notStarted = new Date(sale.startAt).getTime() > Date.now();
  const delSale = useMutation({
    mutationFn: () => deleteFlashSale(sale.id),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: (e) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra'),
  });
  // Tắt đợt đang bật làm giá sale biến mất với khách ngay (kể cả đợt đang chạy), nên hỏi trước; bật lại thì chạy luôn.
  const askToggleActive = async () => {
    if (sale.isActive) {
      const ok = await confirm({
        title: 'Tắt đợt flash sale',
        message: `Tắt "${sale.title}"? Giá flash sale biến mất với khách ngay; bật lại sau là được.`,
        confirmLabel: 'Tắt đợt',
        cancelLabel: 'Giữ nguyên',
        tone: 'danger',
      });
      if (!ok) return;
    }
    toggleActive.mutate();
  };
  const askDeleteSale = async () => {
    const ok = await confirm({
      title: 'Xoá đợt flash sale',
      message: `Xoá "${sale.title}"? Mọi sản phẩm và lượt nhắc trong đợt sẽ bị xoá theo, không hoàn tác được.`,
      confirmLabel: 'Xoá đợt',
      cancelLabel: 'Giữ lại',
      tone: 'danger',
    });
    if (ok) delSale.mutate();
  };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', startAt: '', endAt: '' });
  const startEdit = () => {
    setDraft({ title: sale.title, startAt: toDatetimeLocal(sale.startAt), endAt: toDatetimeLocal(sale.endAt) });
    setRowErr(null);
    setEditing(true);
  };
  const original = { title: sale.title, startAt: toDatetimeLocal(sale.startAt), endAt: toDatetimeLocal(sale.endAt) };
  const changed = draft.title !== original.title || draft.startAt !== original.startAt || draft.endAt !== original.endAt;
  const saveEdit = useMutation({
    mutationFn: () =>
      updateFlashSale(sale.id, {
        ...(draft.title !== original.title ? { title: draft.title.trim() } : {}),
        ...(draft.startAt !== original.startAt ? { startAt: new Date(draft.startAt).toISOString() } : {}),
        ...(draft.endAt !== original.endAt ? { endAt: new Date(draft.endAt).toISOString() } : {}),
      }),
    onSuccess: () => { setRowErr(null); setEditing(false); refresh(); },
    onError: (e) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra'),
  });

  const [item, setItem] = useState(EMPTY_ITEM);
  const [pickedVariation, setPickedVariation] = useState<PickedItem | null>(null);
  const [itemErr, setItemErr] = useState<string | null>(null);
  const variationLabels = useVariationLabels(sale.items.map((it) => it.variationId));
  const addItem = useMutation({
    mutationFn: () =>
      addFlashSaleItem(sale.id, {
        variationId: item.variationId.trim(),
        flashPrice: Number(item.flashPrice),
        quota: Number(item.quota),
        perUserLimit: item.perUserLimit ? Number(item.perUserLimit) : undefined,
      }),
    onSuccess: () => {
      setItem(EMPTY_ITEM);
      setPickedVariation(null);
      setItemErr(null);
      refresh();
    },
    onError: (e) => setItemErr(e instanceof Error ? e.message : 'Lỗi thêm sản phẩm'),
  });
  const itemReady = !!item.variationId.trim() && Number(item.flashPrice) >= 1 && Number(item.quota) >= 1;

  const fmt = formatDateTime;
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium text-stone-900">
            {sale.title}
            <ToneBadge tone={sale.isActive ? 'success' : 'neutral'}>{sale.isActive ? 'Đang bật' : 'Đang tắt'}</ToneBadge>
          </div>
          <div className="break-words text-xs text-stone-500">{fmt(sale.startAt)} → {fmt(sale.endAt)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button onClick={() => (editing ? setEditing(false) : startEdit())} className={BTN_SECONDARY}>
            Sửa đợt
          </button>
          <button onClick={() => void askToggleActive()} disabled={toggleActive.isPending} className={BTN_SECONDARY}>
            {sale.isActive ? 'Tắt' : 'Bật'}
          </button>
          {notStarted && (
            <button onClick={() => void askDeleteSale()} disabled={delSale.isPending} className={BTN_DANGER_OUTLINE}>
              Xoá đợt
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-control border border-stone-200 bg-stone-50 p-3">
          <div className="grow basis-full sm:basis-48">
            <Field label="Tên đợt (sửa)">
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`${field} w-full`} />
            </Field>
          </div>
          <Field label="Bắt đầu lúc (sửa)">
            <input
              type="datetime-local"
              value={draft.startAt}
              onChange={(e) => setDraft({ ...draft, startAt: e.target.value })}
              disabled={!notStarted}
              className={`${field} disabled:cursor-not-allowed disabled:opacity-60`}
            />
          </Field>
          <Field label="Kết thúc lúc (sửa)">
            <input type="datetime-local" value={draft.endAt} onChange={(e) => setDraft({ ...draft, endAt: e.target.value })} className={field} />
          </Field>
          <button
            onClick={() => saveEdit.mutate()}
            disabled={!changed || !draft.title.trim() || !draft.startAt || !draft.endAt || saveEdit.isPending}
            className={BTN_PRIMARY}
          >
            {saveEdit.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
          <button onClick={() => setEditing(false)} className={BTN_SECONDARY}>
            Huỷ sửa
          </button>
          {!notStarted && (
            <p className="basis-full text-xs text-stone-600">
              Đợt đã bắt đầu: không đổi được giờ bắt đầu (khách đã thấy giá). Chỉ sửa được tên, giờ kết thúc hoặc tắt đợt.
            </p>
          )}
        </div>
      )}
      {rowErr && <p className="mt-1 text-sm text-danger-fg">{rowErr}</p>}

      <div className="mt-3 border-t border-stone-200 pt-3">
        <div className="mb-1 text-sm font-medium text-stone-900">Sản phẩm trong đợt ({sale.items.length})</div>
        <div className="space-y-1">
          {sale.items.map((it) => (
            <div key={it.id} className={LIST_ITEM_CLASS}>
              <span className="min-w-0 break-words">
                {variationLabels.labelFor(it.variationId)} · {formatVnd(it.flashPrice)} · đã bán {it.soldCount}/{it.quota} · giới hạn {it.perUserLimit}/khách
              </span>
              <button
                onClick={async () => {
                  const label = variationLabels.labelFor(it.variationId);
                  const ok = await confirm({
                    title: 'Xoá sản phẩm khỏi đợt',
                    message: `Xoá "${label}" khỏi đợt "${sale.title}"? Đã bán ${it.soldCount}/${it.quota}. Không hoàn tác được.`,
                    confirmLabel: 'Xoá sản phẩm',
                    cancelLabel: 'Giữ lại',
                    tone: 'danger',
                  });
                  if (ok) delItem.mutate(it.id);
                }}
                className={`${BTN_LINK_DANGER} shrink-0 text-xs`}
              >Xoá</button>
            </div>
          ))}
          {sale.items.length === 0 && <p className="text-xs text-stone-500">Chưa có sản phẩm nào trong đợt này.</p>}
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-2">
          <ProductPicker
            mode="variation"
            label="Chọn biến thể sản phẩm cho đợt Flash Sale"
            value={pickedVariation}
            onChange={(v) => {
              setPickedVariation(v);
              setItem((cur) => ({ ...cur, variationId: v?.id ?? '' }));
            }}
            className="min-w-[14rem] flex-1"
          />
          <div className="w-28">
            <Field label="Giá flash (đ)">
              <input type="number" min={1} step={1} inputMode="numeric" placeholder="vd 59000" value={item.flashPrice} onChange={(e) => setItem({ ...item, flashPrice: e.target.value })} className={`${field} w-full`} />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Số lượng bán (quota)">
              <input type="number" min={1} step={1} inputMode="numeric" placeholder="vd 20" value={item.quota} onChange={(e) => setItem({ ...item, quota: e.target.value })} className={`${field} w-full`} />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Giới hạn mỗi khách">
              <input type="number" min={1} step={1} inputMode="numeric" placeholder="mặc định" value={item.perUserLimit} onChange={(e) => setItem({ ...item, perUserLimit: e.target.value })} className={`${field} w-full`} />
            </Field>
          </div>
          <button onClick={() => addItem.mutate()} disabled={!itemReady || addItem.isPending} className={BTN_PRIMARY}>
            Thêm SP
          </button>
        </div>
        <p className="mt-1 text-xs text-stone-500">Gõ tên sản phẩm (không cần dấu) hoặc SKU rồi chọn đúng biến thể.</p>
        {itemErr && <p className="mt-1 text-sm text-danger-fg">{itemErr}</p>}
      </div>
      {dialog}
    </div>
  );
}

// ── FAQ / câu trả lời nhanh (CSKH + nạp vào AI tư vấn) ──
function FaqTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-faqs'], queryFn: listFaqs });
  const [form, setForm] = useState({ category: '', question: '', answer: '', sortOrder: 0 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createFaq({
        category: form.category.trim() || undefined,
        question: form.question.trim(),
        answer: form.answer.trim(),
        sortOrder: Number(form.sortOrder) || 0,
      }),
    onSuccess: () => {
      setForm({ category: '', question: '', answer: '', sortOrder: 0 });
      setMsg({ ok: true, text: 'Đã thêm câu hỏi thường gặp!' });
      void qc.invalidateQueries({ queryKey: ['admin-faqs'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi tạo câu hỏi thường gặp' }),
  });
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className="space-y-4">
      <div className={CARD_CLASS}>
        <h2 className="mb-2 font-display text-sm font-semibold text-stone-900">Thêm câu hỏi thường gặp</h2>
        <p className="mb-2 text-xs text-stone-500">Nội dung này cũng được nạp vào ngữ cảnh của AI tư vấn để trả lời nhất quán.</p>
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nhóm">
              <input
                placeholder="Nhóm (vd Vận chuyển, Đổi trả)"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className={`${field} w-56`}
              />
            </Field>
            <Field label="Thứ tự hiển thị">
              <input
                type="number"
                placeholder="Thứ tự hiển thị"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                className={`${field} w-32`}
              />
            </Field>
          </div>
          <Field label="Câu hỏi">
            <input
              placeholder="Câu hỏi"
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              className={`${INPUT_CLASS} ${TOUCH_H}`}
            />
          </Field>
          <Field label="Câu trả lời">
            <textarea
              placeholder="Câu trả lời"
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              rows={3}
              className={INPUT_CLASS}
            />
          </Field>
          <button
            onClick={() => { setMsg(null); create.mutate(); }}
            disabled={!form.question.trim() || !form.answer.trim() || create.isPending}
            className={BTN_PRIMARY}
          >
            {create.isPending ? 'Đang thêm…' : 'Thêm câu hỏi'}
          </button>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</p>}
      </div>

      <div className="space-y-2">
        {q.isError && <LoadError message="Không tải được danh sách câu hỏi thường gặp." onRetry={() => void q.refetch()} />}
        {q.data?.map((f) => <FaqRow key={f.id} faq={f} />)}
        {q.data?.length === 0 && <Empty>Chưa có câu hỏi thường gặp nào. Thêm câu đầu tiên ở trên.</Empty>}
      </div>
    </div>
  );
}

function FaqRow({ faq }: { faq: AdminFaq }) {
  const { askDelete, dialog } = useDeleteConfirm();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-faqs'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const onRowError = (e: unknown) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại.');
  const toggleActive = useMutation({
    mutationFn: () => updateFaq(faq.id, { isActive: !faq.isActive }),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const del = useMutation({
    mutationFn: () => deleteFaq(faq.id),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const [f, setF] = useState({ category: faq.category ?? '', question: faq.question, answer: faq.answer, sortOrder: faq.sortOrder });
  const save = useMutation({
    mutationFn: () =>
      updateFaq(faq.id, {
        category: f.category.trim() || undefined,
        question: f.question.trim(),
        answer: f.answer.trim(),
        sortOrder: Number(f.sortOrder) || 0,
      }),
    onSuccess: () => { setOpen(false); refresh(); },
  });
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {faq.category && <ToneBadge tone="neutral">{faq.category}</ToneBadge>}
            <ToneBadge tone={faq.isActive ? 'success' : 'neutral'}>{faq.isActive ? 'Đang hiện' : 'Đang ẩn'}</ToneBadge>
            <span className="text-xs text-stone-500">thứ tự {faq.sortOrder}</span>
          </div>
          <div className="mt-1 break-words font-medium text-stone-900">{faq.question}</div>
          <div className="mt-0.5 whitespace-pre-line break-words text-sm text-stone-600">{faq.answer}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={() => setOpen((o) => !o)} className={`${BTN_LINK} text-sm`}>{open ? 'Đóng' : 'Sửa'}</button>
          <button onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending} className={`${BTN_LINK_MUTED} text-xs`}>
            {faq.isActive ? 'Ẩn' : 'Hiện'}
          </button>
          <button
            onClick={() => askDelete({ title: 'Xoá câu hỏi thường gặp', message: `Xoá câu hỏi "${faq.question}"? Câu trả lời này cũng không còn được nạp cho AI tư vấn. Không hoàn tác được.`, confirmLabel: 'Xoá câu hỏi' }, () => del.mutate())}
            disabled={del.isPending}
            className={`${BTN_LINK_DANGER} text-xs`}
          >Xoá</button>
        </div>
      </div>
      {rowErr && <p className="mt-1 text-xs text-danger-fg">{rowErr}</p>}

      {open && (
        <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nhóm">
              <input placeholder="Nhóm" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={`${field} w-56`} />
            </Field>
            <Field label="Thứ tự hiển thị">
              <input type="number" placeholder="Thứ tự" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} className={`${field} w-32`} />
            </Field>
          </div>
          <Field label="Câu hỏi">
            <input placeholder="Câu hỏi" value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} className={`${INPUT_CLASS} ${TOUCH_H}`} />
          </Field>
          <Field label="Câu trả lời">
            <textarea placeholder="Câu trả lời" value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} rows={3} className={INPUT_CLASS} />
          </Field>
          <button
            onClick={() => save.mutate()}
            disabled={!f.question.trim() || !f.answer.trim() || save.isPending}
            className={BTN_PRIMARY}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          {save.isError && <p className="text-sm text-danger-fg">{(save.error as Error).message}</p>}
        </div>
      )}
      {dialog}
    </div>
  );
}

function parseKeywords(raw: string): string[] {
  return raw.split(',').map((k) => k.trim()).filter(Boolean);
}

function QuickReplyTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-quick-replies'], queryFn: listQuickReplies });
  const [form, setForm] = useState({ category: '', keywords: '', title: '', content: '', isGreeting: false });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createQuickReply({
        category: form.category.trim() || undefined,
        keywords: parseKeywords(form.keywords),
        title: form.title.trim(),
        content: form.content.trim(),
        isGreeting: form.isGreeting,
      }),
    onSuccess: () => {
      setForm({ category: '', keywords: '', title: '', content: '', isGreeting: false });
      setMsg({ ok: true, text: 'Đã thêm mẫu tin nhanh!' });
      void qc.invalidateQueries({ queryKey: ['admin-quick-replies'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi tạo mẫu tin nhanh' }),
  });
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className="space-y-4">
      <div className={CARD_CLASS}>
        <h2 className="mb-2 font-display text-sm font-semibold text-stone-900">Thêm mẫu tin nhanh</h2>
        <p className="mb-2 text-xs text-stone-500">
          Dùng để auto-reply khi khách nhắn vào Zalo OA — so khớp từ khoá (cách nhau bằng dấu phẩy),
          hoặc bật &quot;Lời chào tự động&quot; để gửi cho tin nhắn đầu tiên của khách.
        </p>
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nhóm">
              <input
                placeholder="Nhóm (vd Vận chuyển, Đổi trả)"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className={`${field} w-56`}
              />
            </Field>
            <Field label="Tên nội bộ">
              <input
                placeholder="Tên nội bộ"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className={`${field} w-56`}
              />
            </Field>
          </div>
          <Field label="Từ khoá kích hoạt">
            <input
              placeholder="Từ khoá kích hoạt, cách nhau bằng dấu phẩy (vd ship, phí vận chuyển)"
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              disabled={form.isGreeting}
              className={`${INPUT_CLASS} ${TOUCH_H}`}
            />
          </Field>
          <Field label="Nội dung tin trả lời">
            <textarea
              placeholder="Nội dung tin trả lời"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={3}
              className={INPUT_CLASS}
            />
          </Field>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-stone-600 sm:min-h-0">
            <input
              type="checkbox"
              className="h-4 w-4 accent-forest-600"
              checked={form.isGreeting}
              onChange={(e) => setForm({ ...form, isGreeting: e.target.checked })}
            />
            Dùng làm lời chào tự động (tin nhắn đầu tiên của khách)
          </label>
          <button
            onClick={() => { setMsg(null); create.mutate(); }}
            disabled={!form.title.trim() || !form.content.trim() || create.isPending}
            className={BTN_PRIMARY}
          >
            {create.isPending ? 'Đang thêm…' : 'Thêm mẫu tin'}
          </button>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</p>}
      </div>

      <div className="space-y-2">
        {q.isError && <LoadError message="Không tải được danh sách mẫu tin nhanh." onRetry={() => void q.refetch()} />}
        {q.data?.map((r) => <QuickReplyRow key={r.id} item={r} />)}
        {q.data?.length === 0 && <Empty>Chưa có mẫu tin nhanh nào. Thêm mẫu đầu tiên ở trên.</Empty>}
      </div>
    </div>
  );
}

function QuickReplyRow({ item }: { item: AdminQuickReply }) {
  const { askDelete, dialog } = useDeleteConfirm();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-quick-replies'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const onRowError = (e: unknown) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại.');
  const toggleActive = useMutation({
    mutationFn: () => updateQuickReply(item.id, { isActive: !item.isActive }),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const del = useMutation({
    mutationFn: () => deleteQuickReply(item.id),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const [f, setF] = useState({
    category: item.category ?? '',
    keywords: item.keywords.join(', '),
    title: item.title,
    content: item.content,
    isGreeting: item.isGreeting,
  });
  const save = useMutation({
    mutationFn: () =>
      updateQuickReply(item.id, {
        category: f.category.trim() || undefined,
        keywords: parseKeywords(f.keywords),
        title: f.title.trim(),
        content: f.content.trim(),
        isGreeting: f.isGreeting,
      }),
    onSuccess: () => { setOpen(false); refresh(); },
  });
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {item.category && <ToneBadge tone="neutral">{item.category}</ToneBadge>}
            {item.isGreeting && <ToneBadge tone="warning">Lời chào</ToneBadge>}
            <ToneBadge tone={item.isActive ? 'success' : 'neutral'}>{item.isActive ? 'Đang bật' : 'Đang tắt'}</ToneBadge>
          </div>
          <div className="mt-1 break-words font-medium text-stone-900">{item.title}</div>
          {item.keywords.length > 0 && (
            <div className="mt-0.5 break-words text-xs text-stone-500">Từ khoá: {item.keywords.join(', ')}</div>
          )}
          <div className="mt-0.5 whitespace-pre-line break-words text-sm text-stone-600">{item.content}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={() => setOpen((o) => !o)} className={`${BTN_LINK} text-sm`}>{open ? 'Đóng' : 'Sửa'}</button>
          <button onClick={() => toggleActive.mutate()} disabled={toggleActive.isPending} className={`${BTN_LINK_MUTED} text-xs`}>
            {item.isActive ? 'Tắt' : 'Bật'}
          </button>
          <button
            onClick={() => askDelete({ title: 'Xoá mẫu tin nhanh', message: `Xoá mẫu "${item.title}"? Nếu mẫu đang dùng cho tự động trả lời trên OA thì OA không còn gửi mẫu này. Không hoàn tác được.`, confirmLabel: 'Xoá mẫu' }, () => del.mutate())}
            disabled={del.isPending}
            className={`${BTN_LINK_DANGER} text-xs`}
          >Xoá</button>
        </div>
      </div>
      {rowErr && <p className="mt-1 text-xs text-danger-fg">{rowErr}</p>}

      {open && (
        <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nhóm">
              <input placeholder="Nhóm" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={`${field} w-56`} />
            </Field>
            <Field label="Tên nội bộ">
              <input placeholder="Tên nội bộ" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={`${field} w-56`} />
            </Field>
          </div>
          <Field label="Từ khoá kích hoạt">
            <input
              placeholder="Từ khoá, cách nhau bằng dấu phẩy"
              value={f.keywords}
              onChange={(e) => setF({ ...f, keywords: e.target.value })}
              disabled={f.isGreeting}
              className={`${INPUT_CLASS} ${TOUCH_H}`}
            />
          </Field>
          <Field label="Nội dung tin trả lời">
            <textarea placeholder="Nội dung" value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} rows={3} className={INPUT_CLASS} />
          </Field>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-stone-600 sm:min-h-0">
            <input type="checkbox" className="h-4 w-4 accent-forest-600" checked={f.isGreeting} onChange={(e) => setF({ ...f, isGreeting: e.target.checked })} />
            Dùng làm lời chào tự động
          </label>
          <button
            onClick={() => save.mutate()}
            disabled={!f.title.trim() || !f.content.trim() || save.isPending}
            className={BTN_PRIMARY}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          {save.isError && <p className="text-sm text-danger-fg">{(save.error as Error).message}</p>}
        </div>
      )}
      {dialog}
    </div>
  );
}

// ── Content Kit CTV (bài mẫu/USP/FAQ/media per-sản phẩm) ──
// Emoji trong caption mẫu là nội dung CTV sẽ đăng, không phải biểu tượng giao diện: viết bằng mã escape để bánh cóc emoji chỉ bắt icon.
const CAPTION_PLACEHOLDER = 'Mình đang dùng sản phẩm này, ưng lắm! Mua qua {link} nhé {ten_ctv} \u{1F33F}';

function ContentKitTab() {
  const [pickedProduct, setPickedProduct] = useState<PickedItem | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin-content-kit', loadedId],
    queryFn: () => getContentKit(loadedId as string),
    enabled: !!loadedId,
  });

  return (
    <div className="space-y-4">
      <div className={CARD_CLASS}>
        <h2 className="mb-2 font-display text-sm font-semibold text-stone-900">Soạn Content Kit theo sản phẩm</h2>
        <p className="mb-2 text-xs text-stone-500">
          Chọn sản phẩm bằng cách gõ tên (không cần dấu) hoặc SKU. Trong caption dùng{' '}
          <code>{'{ten_ctv}'}</code> và <code>{'{link}'}</code> — hệ thống sẽ tự chèn tên CTV + link giới thiệu khi CTV xem.
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <ProductPicker mode="product" label="Chọn sản phẩm cho Content Kit" value={pickedProduct} onChange={setPickedProduct} className="min-w-[14rem] flex-1" />
          <button
            onClick={() => pickedProduct && setLoadedId(pickedProduct.id)}
            disabled={!pickedProduct}
            className={BTN_PRIMARY}
          >
            Tải
          </button>
        </div>
      </div>

      {loadedId && q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {loadedId && q.isError && <p className="text-sm text-danger-fg">{(q.error as Error).message}</p>}
      {loadedId && q.isSuccess && (
        <ContentKitEditor key={loadedId} productId={loadedId} initial={q.data} />
      )}
    </div>
  );
}

function ContentKitEditor({
  productId,
  initial,
}: {
  productId: string;
  initial: { captions: string[]; usps: string[]; faqs: ContentKitFaq[] | null; videoUrls: string[] } | null;
}) {
  const qc = useQueryClient();
  const uid = useId();
  const [captions, setCaptions] = useState((initial?.captions ?? []).join('\n'));
  const [usps, setUsps] = useState((initial?.usps ?? []).join('\n'));
  const [videoUrls, setVideoUrls] = useState((initial?.videoUrls ?? []).join('\n'));
  const [faqs, setFaqs] = useState<ContentKitFaq[]>(initial?.faqs ?? []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toLines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

  const save = useMutation({
    mutationFn: () =>
      saveContentKit(productId, {
        captions: toLines(captions),
        usps: toLines(usps),
        videoUrls: toLines(videoUrls),
        faqs: faqs.filter((f) => f.q.trim() && f.a.trim()),
      }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã lưu Content Kit!' });
      void qc.invalidateQueries({ queryKey: ['admin-content-kit', productId] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi lưu Content Kit' }),
  });

  const setFaq = (i: number, patch: Partial<ContentKitFaq>) =>
    setFaqs((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const field = `${FIELD_CLASS} ${TOUCH_H} grow basis-40`;

  return (
    <div className={CARD_CLASS}>
      <div className="mb-2 break-all text-sm font-medium text-stone-900">Sản phẩm: {productId}</div>

      <label htmlFor={`${uid}-captions`} className="mb-1 block text-xs font-medium text-stone-600">Bài mẫu (mỗi dòng 1 caption)</label>
      <textarea
        id={`${uid}-captions`}
        value={captions}
        onChange={(e) => setCaptions(e.target.value)}
        rows={5}
        placeholder={CAPTION_PLACEHOLDER}
        className={`mb-3 ${INPUT_CLASS}`}
      />

      <label htmlFor={`${uid}-usps`} className="mb-1 block text-xs font-medium text-stone-600">USP / điểm bán hàng (mỗi dòng 1 ý)</label>
      <textarea
        id={`${uid}-usps`}
        value={usps}
        onChange={(e) => setUsps(e.target.value)}
        rows={3}
        placeholder={'Nguyên liệu tự nhiên'}
        className={`mb-3 ${INPUT_CLASS}`}
      />

      <label htmlFor={`${uid}-videos`} className="mb-1 block text-xs font-medium text-stone-600">Video URL (mỗi dòng 1 link)</label>
      <textarea
        id={`${uid}-videos`}
        value={videoUrls}
        onChange={(e) => setVideoUrls(e.target.value)}
        rows={2}
        placeholder={'https://...'}
        className={`mb-3 ${INPUT_CLASS}`}
      />

      <div className="mb-1 text-xs font-medium text-stone-600">FAQ (câu hỏi thường gặp)</div>
      <div className="space-y-1">
        {faqs.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <input
              placeholder="Câu hỏi"
              aria-label={`Câu hỏi ${i + 1}`}
              value={f.q}
              onChange={(e) => setFaq(i, { q: e.target.value })}
              className={field}
            />
            <input
              placeholder="Câu trả lời"
              aria-label={`Câu trả lời ${i + 1}`}
              value={f.a}
              onChange={(e) => setFaq(i, { a: e.target.value })}
              className={field}
            />
            <button onClick={() => setFaqs((fs) => fs.filter((_, idx) => idx !== i))} className={`${BTN_LINK_DANGER} text-xs`}>
              Xoá
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => setFaqs((fs) => [...fs, { q: '', a: '' }])}
        className={`${BTN_LINK} mt-1 text-sm`}
      >
        + Thêm FAQ
      </button>

      <div className="mt-3">
        <button
          onClick={() => { setMsg(null); save.mutate(); }}
          disabled={save.isPending}
          className={BTN_PRIMARY}
        >
          {save.isPending ? 'Đang lưu…' : 'Lưu Content Kit'}
        </button>
        {msg && <span className={`ml-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

// ── CTV Academy (khoá học/bài học đào tạo CTV) ──
function AcademyTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-academy-courses'], queryFn: listAcademyCourses });
  const [form, setForm] = useState({ title: '', description: '', coverUrl: '', sortOrder: 0 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createAcademyCourse({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        coverUrl: form.coverUrl.trim() || undefined,
        sortOrder: Number(form.sortOrder) || 0,
      }),
    onSuccess: () => {
      setForm({ title: '', description: '', coverUrl: '', sortOrder: 0 });
      setMsg({ ok: true, text: 'Đã tạo khoá học!' });
      void qc.invalidateQueries({ queryKey: ['admin-academy-courses'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Lỗi tạo khoá học' }),
  });
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className="space-y-4">
      <div className={CARD_CLASS}>
        <h2 className="mb-2 font-display text-sm font-semibold text-stone-900">Tạo khoá học mới</h2>
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grow basis-full sm:basis-48">
              <Field label="Tiêu đề khoá học">
                <input
                  placeholder="Tiêu đề khoá học"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={`${field} w-full`}
                />
              </Field>
            </div>
            <Field label="Thứ tự">
              <input
                type="number"
                placeholder="Thứ tự"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                className={`${field} w-28`}
              />
            </Field>
          </div>
          <Field label="Ảnh bìa (URL)">
            <input
              placeholder="Ảnh bìa (URL)"
              value={form.coverUrl}
              onChange={(e) => setForm({ ...form, coverUrl: e.target.value })}
              className={`${INPUT_CLASS} ${TOUCH_H}`}
            />
          </Field>
          <Field label="Mô tả">
            <textarea
              placeholder="Mô tả"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className={INPUT_CLASS}
            />
          </Field>
          <button
            onClick={() => { setMsg(null); create.mutate(); }}
            disabled={!form.title.trim() || create.isPending}
            className={BTN_PRIMARY}
          >
            {create.isPending ? 'Đang tạo…' : 'Tạo khoá học'}
          </button>
        </div>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</p>}
      </div>

      <div className="space-y-3">
        {q.isError && <LoadError message="Không tải được danh sách khoá học." onRetry={() => void q.refetch()} />}
        {q.data?.map((c) => <CourseRow key={c.id} course={c} />)}
        {q.data?.length === 0 && <Empty>Chưa có khoá học nào. Tạo khoá đầu tiên ở trên.</Empty>}
      </div>
    </div>
  );
}

function CourseRow({ course }: { course: AdminCourse }) {
  const { askDelete, dialog } = useDeleteConfirm();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-academy-courses'] });
  const [rowErr, setRowErr] = useState<string | null>(null);
  const onRowError = (e: unknown) => setRowErr(e instanceof Error ? e.message : 'Có lỗi xảy ra, vui lòng thử lại.');
  const togglePublish = useMutation({
    mutationFn: () => updateAcademyCourse(course.id, { isPublished: !course.isPublished }),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const del = useMutation({
    mutationFn: () => deleteAcademyCourse(course.id),
    onSuccess: () => { setRowErr(null); refresh(); },
    onError: onRowError,
  });
  const [f, setF] = useState({
    title: course.title,
    description: course.description ?? '',
    coverUrl: course.coverUrl ?? '',
    sortOrder: course.sortOrder,
  });
  const save = useMutation({
    mutationFn: () =>
      updateAcademyCourse(course.id, {
        title: f.title.trim(),
        description: f.description.trim() || undefined,
        coverUrl: f.coverUrl.trim() || undefined,
        sortOrder: Number(f.sortOrder) || 0,
      }),
    onSuccess: refresh,
  });

  const [lesson, setLesson] = useState<{
    title: string;
    contentType: AcademyLessonContentType;
    videoUrl: string;
    body: string;
    sortOrder: number;
  }>({ title: '', contentType: 'ARTICLE', videoUrl: '', body: '', sortOrder: 0 });
  const addLesson = useMutation({
    mutationFn: () =>
      addAcademyLesson(course.id, {
        title: lesson.title.trim(),
        contentType: lesson.contentType,
        videoUrl: lesson.contentType === 'VIDEO' ? lesson.videoUrl.trim() || undefined : undefined,
        body: lesson.contentType === 'ARTICLE' ? lesson.body.trim() || undefined : undefined,
        sortOrder: Number(lesson.sortOrder) || 0,
      }),
    onSuccess: () => {
      setLesson({ title: '', contentType: 'ARTICLE', videoUrl: '', body: '', sortOrder: 0 });
      refresh();
    },
  });
  const field = `${FIELD_CLASS} ${TOUCH_H}`;
  const input = `${INPUT_CLASS} ${TOUCH_H}`;

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium text-stone-900">
            {course.title}
            <ToneBadge tone={course.isPublished ? 'success' : 'neutral'}>{course.isPublished ? 'Đã đăng' : 'Nháp'}</ToneBadge>
          </div>
          <div className="text-xs text-stone-500">{course.lessons.length} bài học · thứ tự {course.sortOrder}</div>
        </div>
        <button onClick={() => setOpen((o) => !o)} className={`${BTN_LINK} shrink-0 text-sm`}>{open ? 'Thu gọn' : 'Quản lý'}</button>
      </div>

      {open && (
        <div className="mt-3 space-y-4 border-t border-stone-200 pt-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => togglePublish.mutate()} disabled={togglePublish.isPending} className={BTN_SECONDARY}>
              {course.isPublished ? 'Chuyển về nháp' : 'Đăng (publish)'}
            </button>
            <button
              onClick={() => askDelete({
                title: 'Xoá khoá học',
                message: `Xoá khoá học "${course.title}" cùng ${course.lessons.length} bài học? Tiến độ học của học viên trong khoá này cũng mất. Không hoàn tác được.`,
                confirmLabel: 'Xoá khoá học',
              }, () => del.mutate())}
              disabled={del.isPending}
              className={BTN_DANGER_OUTLINE}
            >
              Xoá khoá học
            </button>
          </div>
          {rowErr && <p className="text-xs text-danger-fg">{rowErr}</p>}

          <div className="rounded-card border border-stone-200 bg-stone-50 p-3">
            <div className="mb-2 font-display text-sm font-medium text-stone-900">Thông tin khoá học</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Tiêu đề khoá học">
                <input placeholder="Tiêu đề" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={input} />
              </Field>
              <Field label="Thứ tự">
                <input type="number" placeholder="Thứ tự" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} className={input} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Ảnh bìa (URL)">
                  <input placeholder="Ảnh bìa (URL)" value={f.coverUrl} onChange={(e) => setF({ ...f, coverUrl: e.target.value })} className={input} />
                </Field>
              </div>
            </div>
            <div className="mt-2">
              <Field label="Mô tả">
                <textarea placeholder="Mô tả" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} className={INPUT_CLASS} />
              </Field>
            </div>
            <button onClick={() => save.mutate()} disabled={!f.title.trim() || save.isPending} className={`${BTN_PRIMARY} mt-2`}>
              {save.isPending ? 'Đang lưu…' : 'Lưu thông tin'}
            </button>
            {save.isSuccess && <span className="ml-2 inline-flex items-center gap-1 text-sm text-success-fg">Đã lưu <Check className="h-4 w-4" aria-hidden /></span>}
            {save.isError && <span className="ml-2 text-sm text-danger-fg">{(save.error as Error).message}</span>}
          </div>

          <div>
            <div className="mb-1 text-sm font-medium text-stone-900">Bài học ({course.lessons.length})</div>
            <div className="space-y-1">
              {course.lessons.map((l) => <LessonRow key={l.id} lesson={l} />)}
              {course.lessons.length === 0 && <p className="text-xs text-stone-500">Chưa có bài học nào.</p>}
            </div>

            <div className="mt-2 space-y-2 rounded-control border border-stone-200 p-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="grow basis-full sm:basis-40">
                  <Field label="Tiêu đề bài học">
                    <input
                      placeholder="Tiêu đề bài học"
                      value={lesson.title}
                      onChange={(e) => setLesson({ ...lesson, title: e.target.value })}
                      className={`${field} w-full`}
                    />
                  </Field>
                </div>
                <Field label="Loại bài học">
                  <select
                    aria-label="Loại bài học"
                    value={lesson.contentType}
                    onChange={(e) => setLesson({ ...lesson, contentType: e.target.value as AcademyLessonContentType })}
                    className={field}
                  >
                    <option value="ARTICLE">Bài viết</option>
                    <option value="VIDEO">Video</option>
                  </select>
                </Field>
                <Field label="Thứ tự">
                  <input
                    type="number"
                    placeholder="Thứ tự"
                    value={lesson.sortOrder}
                    onChange={(e) => setLesson({ ...lesson, sortOrder: Number(e.target.value) })}
                    className={`${field} w-24`}
                  />
                </Field>
              </div>
              {lesson.contentType === 'VIDEO' ? (
                <Field label="Link video">
                  <input
                    placeholder="Video URL"
                    value={lesson.videoUrl}
                    onChange={(e) => setLesson({ ...lesson, videoUrl: e.target.value })}
                    className={input}
                  />
                </Field>
              ) : (
                <Field label="Nội dung bài viết">
                  <textarea
                    placeholder="Nội dung bài viết"
                    value={lesson.body}
                    onChange={(e) => setLesson({ ...lesson, body: e.target.value })}
                    rows={3}
                    className={INPUT_CLASS}
                  />
                </Field>
              )}
              <button
                onClick={() => addLesson.mutate()}
                disabled={!lesson.title.trim() || addLesson.isPending}
                className={BTN_PRIMARY}
              >
                Thêm bài học
              </button>
              {addLesson.isError && <p className="text-xs text-danger-fg">{(addLesson.error as Error).message}</p>}
            </div>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}

function LessonRow({ lesson }: { lesson: AdminLesson }) {
  const { askDelete, dialog } = useDeleteConfirm();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-academy-courses'] });
  const del = useMutation({
    mutationFn: () => deleteAcademyLesson(lesson.id),
    onSuccess: refresh,
  });
  const [f, setF] = useState({
    title: lesson.title,
    contentType: lesson.contentType,
    videoUrl: lesson.videoUrl ?? '',
    body: lesson.body ?? '',
    sortOrder: lesson.sortOrder,
  });
  const save = useMutation({
    mutationFn: () =>
      updateAcademyLesson(lesson.id, {
        title: f.title.trim(),
        contentType: f.contentType,
        videoUrl: f.contentType === 'VIDEO' ? f.videoUrl.trim() : undefined,
        body: f.contentType === 'ARTICLE' ? f.body.trim() : undefined,
        sortOrder: Number(f.sortOrder) || 0,
      }),
    onSuccess: () => { setOpen(false); refresh(); },
  });
  const field = `${FIELD_CLASS} ${TOUCH_H}`;

  return (
    <div className="rounded-control border border-stone-200 px-2 py-1 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-words">
          [{lesson.contentType === 'VIDEO' ? 'Video' : 'Bài viết'}] {lesson.title} · thứ tự {lesson.sortOrder}
        </span>
        <div className="flex shrink-0 gap-1">
          <button onClick={() => setOpen((o) => !o)} className={`${BTN_LINK} text-xs`}>{open ? 'Đóng' : 'Sửa'}</button>
          <button
            onClick={() => askDelete({ title: 'Xoá bài học', message: `Xoá bài học "${lesson.title}"? Không hoàn tác được.`, confirmLabel: 'Xoá bài học' }, () => del.mutate())}
            disabled={del.isPending}
            className={`${BTN_LINK_DANGER} text-xs`}
          >Xoá</button>
        </div>
      </div>
      {del.isError && <p className="mt-1 text-xs text-danger-fg">{(del.error as Error).message}</p>}
      {open && (
        <div className="mt-2 space-y-2 border-t border-stone-200 pt-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grow basis-full sm:basis-40">
              <Field label="Tiêu đề bài học">
                <input placeholder="Tiêu đề" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={`${field} w-full`} />
              </Field>
            </div>
            <Field label="Loại bài học">
              <select
                aria-label="Loại bài học"
                value={f.contentType}
                onChange={(e) => setF({ ...f, contentType: e.target.value as AcademyLessonContentType })}
                className={field}
              >
                <option value="ARTICLE">Bài viết</option>
                <option value="VIDEO">Video</option>
              </select>
            </Field>
            <Field label="Thứ tự">
              <input type="number" placeholder="Thứ tự" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} className={`${field} w-24`} />
            </Field>
          </div>
          {f.contentType === 'VIDEO' ? (
            <Field label="Link video">
              <input placeholder="Video URL" value={f.videoUrl} onChange={(e) => setF({ ...f, videoUrl: e.target.value })} className={`${INPUT_CLASS} ${TOUCH_H}`} />
            </Field>
          ) : (
            <Field label="Nội dung bài viết">
              <textarea placeholder="Nội dung bài viết" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={3} className={INPUT_CLASS} />
            </Field>
          )}
          <button onClick={() => save.mutate()} disabled={!f.title.trim() || save.isPending} className={BTN_PRIMARY}>
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          {save.isError && <p className="text-xs text-danger-fg">{(save.error as Error).message}</p>}
        </div>
      )}
      {dialog}
    </div>
  );
}

function Table({ head, label, children }: { head: string[]; label: string; children: React.ReactNode }) {
  return (
    <ScrollRegion label={label} className="rounded-card border border-stone-200 bg-stone-0">
      <table className="w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs text-stone-500">
          <tr>{head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="px-3">{children}</tbody>
      </table>
    </ScrollRegion>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-20 text-center text-stone-600">{children}</main>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">{children}</p>;
}
