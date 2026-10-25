import type { CheckInStatusResponse, CouponDTO, LoyaltyOverview } from './api/loyalty';
import { decimalVi, tierProgressPercent } from './loyalty-copy';

/**
 * Bố cục Trang chủ, thanh đáy, Ưu đãi và hàng trạng thái đơn của trang Cá nhân. Một nguồn cho Mini App và web khổ điện thoại:
 * thứ tự khối, nhãn, mục nào ẩn theo cờ. Mỗi app chỉ gắn biểu tượng và đường dẫn của nền tảng mình.
 */

export type HomeCustomerKind = 'returning' | 'new';

export type HomeBlockId =
  | 'search' | 'member' | 'todo' | 'welcome' | 'shortcuts' | 'purchased' | 'flash' | 'categories' | 'bestSellers' | 'journey'
  | 'community' | 'suggest';

// "Việc cần làm" có ở cả hai thứ tự: khách chưa có đơn đã giao vẫn có thể đang giữ một đơn chờ chuyển khoản, và khối tự rỗng khi không có việc.
const RETURNING: readonly HomeBlockId[] = [
  'search', 'member', 'todo', 'shortcuts', 'purchased', 'flash', 'categories', 'journey', 'community', 'suggest',
];
const NEW: readonly HomeBlockId[] = [
  'search', 'todo', 'welcome', 'shortcuts', 'flash', 'categories', 'bestSellers', 'journey', 'community', 'suggest',
];

export function homeBlockOrder(kind: HomeCustomerKind): readonly HomeBlockId[] {
  return kind === 'returning' ? RETURNING : NEW;
}

/** Khách cũ = đã nhận ít nhất một sản phẩm (kệ Mua lại có hàng). Đang tải hoặc API cũ 404 thì coi là khách mới. */
export function customerKind(purchasedCount: number | undefined): HomeCustomerKind {
  return (purchasedCount ?? 0) > 0 ? 'returning' : 'new';
}

// ---- 8 lối tắt ----

export type HomeShortcutId = 'rewards' | 'garden' | 'recycle' | 'groupBuy' | 'coupons' | 'claim' | 'earn' | 'community';
export type ShortcutTint = 'forest' | 'sage' | 'clay' | 'amber' | 'sky' | 'rose';

export interface HomeShortcutSpec {
  id: HomeShortcutId;
  label: string;
  /** Câu đọc đầy đủ cho trình đọc màn hình. */
  ariaLabel: string;
  tint: ShortcutTint;
  /** Mục chỉ hiện khi cờ này bật. */
  flag?: 'waste' | 'claim';
}

export interface HomeFlags {
  wasteEnabled: boolean;
  claimEnabled: boolean;
}

export const HOME_SHORTCUTS: readonly HomeShortcutSpec[] = [
  { id: 'rewards', label: 'Đổi quà', ariaLabel: 'Đổi quà bằng Điểm Xanh', tint: 'clay' },
  { id: 'garden', label: 'Vườn Xanh', ariaLabel: 'Vườn Xanh, chăm cây nhận quà', tint: 'forest' },
  { id: 'recycle', label: 'Đổi rác', ariaLabel: 'Đổi rác lấy quà', tint: 'sage', flag: 'waste' },
  { id: 'groupBuy', label: 'Mua chung', ariaLabel: 'Mua chung giá tốt', tint: 'amber' },
  { id: 'coupons', label: 'Mã của tôi', ariaLabel: 'Mã giảm giá của tôi', tint: 'rose' },
  { id: 'claim', label: 'Tích điểm đơn sàn', ariaLabel: 'Tích điểm đơn mua trên sàn khác', tint: 'sky', flag: 'claim' },
  { id: 'earn', label: 'Kiếm tiền', ariaLabel: 'Kiếm tiền cùng Tubu', tint: 'amber' },
  { id: 'community', label: 'Cộng đồng', ariaLabel: 'Cộng đồng hỏi đáp', tint: 'sky' },
];

/** Mục có cờ tắt bị bỏ, hàng tự dồn. */
export function visibleHomeShortcuts(flags: HomeFlags): HomeShortcutSpec[] {
  return HOME_SHORTCUTS.filter((s) => (s.flag === 'waste' ? flags.wasteEnabled : s.flag === 'claim' ? flags.claimEnabled : true));
}

// ---- Thanh đáy ----

export type NavTabId = 'home' | 'browse' | 'garden' | 'offers' | 'profile';

export interface NavTabSpec {
  id: NavTabId;
  label: string;
  center?: boolean;
  /** 'offers-dot': chấm đỏ khi có việc ở Ưu đãi. 'active-orders': số đơn đang xử lý. */
  badge?: 'offers-dot' | 'active-orders';
}

export const NAV_TAB_SPECS: readonly NavTabSpec[] = [
  { id: 'home', label: 'Trang chủ' },
  { id: 'browse', label: 'Danh mục' },
  { id: 'garden', label: 'Vườn Xanh', center: true },
  { id: 'offers', label: 'Ưu đãi', badge: 'offers-dot' },
  { id: 'profile', label: 'Cá nhân', badge: 'active-orders' },
];

/** Mã còn dưới số ngày này thì tính là sắp hết hạn. */
export const COUPON_EXPIRING_DAYS = 3;

export type OffersDotReason = 'check-in' | 'coupon-expiring';

/**
 * Chấm đỏ trên tab Ưu đãi: chưa điểm danh hôm nay, hoặc có mã sắp hết hạn. Dữ liệu chưa về (undefined) thì không chấm,
 * để chấm không nháy lên rồi tắt.
 */
export function offersDotReason(
  input: { checkIn?: Pick<CheckInStatusResponse, 'checkedInToday'> | null; coupons?: readonly Pick<CouponDTO, 'endAt'>[] | null },
  now: number,
): OffersDotReason | null {
  if (input.checkIn && !input.checkIn.checkedInToday) return 'check-in';
  const limit = now + COUPON_EXPIRING_DAYS * 24 * 3_600_000;
  const expiring = (input.coupons ?? []).some((c) => {
    const end = Date.parse(c.endAt);
    return Number.isFinite(end) && end >= now && end <= limit;
  });
  return expiring ? 'coupon-expiring' : null;
}

// ---- Hàng trạng thái đơn ở trang Cá nhân ----

export type OrderStatusKey = 'pending_payment' | 'processing' | 'shipping' | 'delivered' | 'subscriptions';

export interface OrderStatusSpec {
  key: OrderStatusKey;
  label: string;
  /** Có số đếm trên biểu tượng. "Đã giao" là lịch sử nên không đếm. */
  counted: boolean;
}

/** Khoá trùng `OrdersTabKey` để mở trang đơn đã lọc bằng `?tab=`. */
export const ORDER_STATUS_ROW: readonly OrderStatusSpec[] = [
  { key: 'pending_payment', label: 'Chờ thanh toán', counted: true },
  { key: 'processing', label: 'Đang xử lý', counted: true },
  { key: 'shipping', label: 'Đang giao', counted: true },
  { key: 'delivered', label: 'Đã giao', counted: false },
  { key: 'subscriptions', label: 'Định kỳ', counted: true },
];

// ---- Thẻ thành viên ----

const num = (n: number) => n.toLocaleString('vi-VN');

export interface MemberCardView {
  tierName: string;
  pointsLabel: string;
  /** "≈ 45.400đ"; null khi chưa biết giá trị một điểm. */
  valueLabel: string | null;
  progressPct: number;
  /** "Còn 18,3 triệu mua hàng lên Đại Thụ"; null khi đã hạng cao nhất hoặc chưa có số. */
  toGoLine: string | null;
}

const moneyShort = (n: number) => (n >= 1_000_000 ? `${decimalVi(n / 1_000_000)} triệu` : `${num(n)}đ`);

export function memberCardView(opts: {
  overview: LoyaltyOverview | undefined;
  /** Tổng điểm hiển thị cho khách (hai lô cộng lại). */
  pointsTotal: number;
  /** Số đồng giảm khi dùng một điểm (cấu hình công khai). */
  vndPerPointRedeem: number | undefined;
}): MemberCardView {
  const { overview, pointsTotal, vndPerPointRedeem } = opts;
  const next = overview?.nextTier ?? null;
  let toGoLine: string | null = null;
  if (next) {
    if (next.spendingToGo != null) toGoLine = `Còn ${moneyShort(next.spendingToGo)} mua hàng lên ${next.name}`;
    else toGoLine = `Còn ${num(next.pointsToGo)} điểm lên ${next.name}`;
  }
  return {
    tierName: overview?.tier?.name ?? 'Mầm Xanh',
    pointsLabel: `${num(pointsTotal)} điểm`,
    valueLabel: vndPerPointRedeem && vndPerPointRedeem > 0 ? `≈ ${num(Math.round(pointsTotal * vndPerPointRedeem))}đ` : null,
    progressPct: overview ? tierProgressPercent(overview) : 0,
    toGoLine,
  };
}

// ---- Gợi ý cuộn vô tận ----

export type SuggestTab = 'for-you' | 'best-seller' | 'newest';

export const SUGGEST_TABS: readonly { key: SuggestTab; label: string; sort?: string }[] = [
  { key: 'for-you', label: 'Cho bạn' },
  { key: 'best-seller', label: 'Bán chạy', sort: 'best_seller' },
  { key: 'newest', label: 'Mới', sort: 'newest' },
];

/** Số sản phẩm mỗi trang của lưới gợi ý. */
export const SUGGEST_PAGE_SIZE = 12;

/** Gộp gợi ý cá nhân hoá lên đầu rồi tới các trang danh mục, bỏ trùng theo id và giữ thứ tự. */
export function mergeSuggestions<T extends { id: string }>(personal: readonly T[], pages: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of [...personal, ...pages.flat()]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Màu nền và màu biểu tượng của ô lối tắt, theo biến thiết kế dùng chung. */
export const SHORTCUT_TINT_VARS: Record<ShortcutTint, { bg: string; fg: string }> = {
  forest: { bg: 'var(--forest-50)', fg: 'var(--forest-600)' },
  sage: { bg: 'var(--sage-100)', fg: 'var(--sage-700)' },
  clay: { bg: 'var(--clay-50)', fg: 'var(--clay-600)' },
  amber: { bg: 'var(--amber-50)', fg: 'var(--amber-600)' },
  sky: { bg: 'var(--blue-50)', fg: 'var(--blue-600)' },
  rose: { bg: 'var(--red-50)', fg: 'var(--red-600)' },
};
