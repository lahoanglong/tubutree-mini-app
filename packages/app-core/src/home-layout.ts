import type { CheckInStatusResponse, CouponDTO, LoyaltyOverview } from './api/loyalty';
import { decimalVi, tierProgressPercent } from './loyalty-copy';

/**
 * Bố cục Trang chủ, thanh đáy, Ưu đãi và hàng trạng thái đơn của trang Cá nhân. Một nguồn cho Mini App và web khổ điện thoại:
 * thứ tự khối, nhãn, mục nào ẩn theo cờ. Mỗi app chỉ gắn biểu tượng và đường dẫn của nền tảng mình.
 */

export type HomeCustomerKind = 'returning' | 'new';
/** Lần mở đầu của khách đã đăng nhập mà app chưa nhớ loại và danh sách đã mua còn đang tải: chưa biết cũ hay mới. */
export type HomeKindState = HomeCustomerKind | 'unknown';

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

// Chưa biết loại khách: giữ chỗ thẻ thành viên (khối `member` hiện khung chờ) và bỏ các khối chỉ một loại có (Mua lại, Quà khách mới,
// Bán chạy), để phần đầu trang không đổi hình dạng khi loại khách được xác định.
const UNKNOWN: readonly HomeBlockId[] = ['search', 'member', 'todo', 'shortcuts', 'flash', 'categories', 'journey', 'community', 'suggest'];

export function homeBlockOrder(kind: HomeKindState): readonly HomeBlockId[] {
  return kind === 'returning' ? RETURNING : kind === 'new' ? NEW : UNKNOWN;
}

/**
 * Loại khách để chọn thứ tự khối. Đang khôi phục phiên (`authPending`) chưa biết là ai: dùng loại đã nhớ của tài khoản dùng gần nhất
 * trên máy (`stored`), chưa nhớ thì "chưa biết"; không bao giờ dựng bố cục khách mới ở bước này (Danh mục sẽ bị đẩy cả một khối khi phiên về).
 * Khách chưa đăng nhập hẳn luôn là mới. Có số liệu đã mua (kể cả cũ, sau một lần tải lại lỗi) thì theo số liệu. Chưa có thì theo loại đã
 * nhớ của chính tài khoản này, kể cả khi tải lỗi: khách cũ không bị đẩy về bố cục khách mới vì một lần API chập chờn. Chưa nhớ gì:
 * đang tải là "chưa biết", lỗi là khách mới.
 */
export function resolveHomeKind(opts: {
  authed: boolean;
  /** Đang khôi phục phiên (chưa biết đăng nhập hay chưa). */
  authPending?: boolean;
  /** Loại đã nhớ: của chính tài khoản khi đã đăng nhập, của tài khoản dùng gần nhất khi đang khôi phục phiên. */
  stored: HomeCustomerKind | null;
  /** Số sản phẩm đã mua trong dữ liệu đang có; undefined = chưa có dữ liệu. */
  purchasedCount: number | undefined;
  pending: boolean;
}): HomeKindState {
  if (opts.authPending && !opts.authed) return opts.stored ?? 'unknown';
  if (!opts.authed) return 'new';
  if (opts.purchasedCount !== undefined) return customerKind(opts.purchasedCount);
  if (opts.stored) return opts.stored;
  return opts.pending ? 'unknown' : 'new';
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
  /** Khách còn yêu cầu đổi rác đang mở: mục Đổi rác vẫn hiện (ghi "Yêu cầu của tôi") dù chương trình tạm dừng. */
  recycleOpenRequests?: boolean;
}

export const RECYCLE_REQUESTS_LABEL = 'Yêu cầu của tôi';

export const HOME_SHORTCUTS: readonly HomeShortcutSpec[] = [
  { id: 'rewards', label: 'Đổi quà', ariaLabel: 'Đổi quà bằng Điểm Xanh', tint: 'clay' },
  { id: 'garden', label: 'Vườn Xanh', ariaLabel: 'Vườn Xanh, chăm cây nhận quà', tint: 'forest' },
  { id: 'recycle', label: 'Đổi rác', ariaLabel: 'Đổi rác lấy quà', tint: 'sage', flag: 'waste' },
  { id: 'groupBuy', label: 'Mua chung', ariaLabel: 'Mua chung giá tốt', tint: 'amber' },
  { id: 'coupons', label: 'Mã của tôi', ariaLabel: 'Mã của tôi, mã giảm giá của bạn', tint: 'rose' },
  { id: 'claim', label: 'Tích điểm đơn sàn', ariaLabel: 'Tích điểm đơn sàn, đơn mua trên sàn khác', tint: 'sky', flag: 'claim' },
  { id: 'earn', label: 'Kiếm tiền', ariaLabel: 'Kiếm tiền cùng Tubu', tint: 'amber' },
  { id: 'community', label: 'Cộng đồng', ariaLabel: 'Cộng đồng hỏi đáp', tint: 'sky' },
];

/**
 * Mục có cờ tắt bị bỏ, hàng tự dồn. Riêng Đổi rác: chương trình tạm dừng mà khách còn yêu cầu đang mở thì vẫn hiện,
 * đổi nhãn thành "Yêu cầu của tôi" để khách còn vào theo dõi, không hứa tính năng đang tạm dừng.
 */
export function visibleHomeShortcuts(flags: HomeFlags): HomeShortcutSpec[] {
  return HOME_SHORTCUTS.flatMap((s): HomeShortcutSpec[] => {
    if (s.flag === 'waste') {
      if (flags.wasteEnabled) return [s];
      return flags.recycleOpenRequests ? [{ ...s, label: RECYCLE_REQUESTS_LABEL, ariaLabel: 'Yêu cầu của tôi về đổi rác' }] : [];
    }
    if (s.flag === 'claim') return flags.claimEnabled ? [s] : [];
    return [s];
  });
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

/** Mã còn hạn và hết hạn trong vòng `COUPON_EXPIRING_DAYS` ngày tới. */
export function isCouponExpiring(c: Pick<CouponDTO, 'endAt'>, now: number): boolean {
  const end = Date.parse(c.endAt);
  return Number.isFinite(end) && end >= now && end <= now + COUPON_EXPIRING_DAYS * 24 * 3_600_000;
}

/** Khoá `code@endAt` của các phiếu sắp hết hạn, để nhớ khách đã xem trang Ưu đãi với những mã nào; gia hạn (endAt đổi) là một khoá mới. */
export function expiringCouponIds(coupons: readonly Pick<CouponDTO, 'code' | 'endAt'>[] | null | undefined, now: number): string[] {
  return (coupons ?? []).filter((c) => isCouponExpiring(c, now)).map((c) => `${c.code}@${c.endAt}`);
}

/** Danh sách đã xem sau khi khách mở Ưu đãi: giữ cái cũ, thêm cái mới, bỏ trùng, chỉ nhớ 50 mã gần nhất. */
export function mergeSeenCouponIds(seen: readonly string[], current: readonly string[]): string[] {
  return [...new Set([...seen, ...current])].slice(-50);
}

export const OFFERS_SEEN_KEY = 'tubu_offers_seen_coupons';

/** Khoá mã sắp hết hạn đã xem của CHÍNH tài khoản này (`{ userId, items }`). Sai dạng, định dạng cũ hay khác tài khoản → rỗng. */
export function readSeenCoupons(storage: MemoryStorage | null, userId: string | null | undefined): string[] {
  if (!storage || !userId) return [];
  try {
    const v = JSON.parse(storage.getItem(OFFERS_SEEN_KEY) ?? 'null') as { userId?: unknown; items?: unknown } | null;
    if (!v || v.userId !== userId || !Array.isArray(v.items)) return [];
    return v.items.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

export function writeSeenCoupons(storage: MemoryStorage | null, userId: string, items: readonly string[]): void {
  try {
    storage?.setItem(OFFERS_SEEN_KEY, JSON.stringify({ userId, items }));
  } catch {
    /* kho bị chặn: chấm tắt trong phiên này, lần mở sau có thể bật lại */
  }
}

/**
 * Chấm đỏ trên tab Ưu đãi. Lý do 1: chưa điểm danh hôm nay, giữ đến khi điểm danh. Lý do 2: có mã sắp hết hạn mà khách chưa thấy
 * khi mở trang Ưu đãi (`seenExpiringIds`); đã xem rồi thì tắt, chỉ bật lại khi có mã mới sắp hết hạn. Dữ liệu chưa về (undefined)
 * thì không chấm, để chấm không nháy lên rồi tắt.
 */
export function offersDotReason(
  input: {
    checkIn?: Pick<CheckInStatusResponse, 'checkedInToday'> | null;
    coupons?: readonly Pick<CouponDTO, 'code' | 'endAt'>[] | null;
    seenExpiringIds?: readonly string[] | null;
  },
  now: number,
): OffersDotReason | null {
  if (input.checkIn && !input.checkIn.checkedInToday) return 'check-in';
  const seen = new Set(input.seenExpiringIds ?? []);
  return expiringCouponIds(input.coupons, now).some((id) => !seen.has(id)) ? 'coupon-expiring' : null;
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
  tierName: string | null;
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
    tierName: overview?.tier?.name ?? null,
    pointsLabel: `${num(pointsTotal)} điểm`,
    valueLabel: vndPerPointRedeem && vndPerPointRedeem > 0 ? `≈ ${num(Math.round(pointsTotal * vndPerPointRedeem))}đ` : null,
    progressPct: overview ? tierProgressPercent(overview) : 0,
    toGoLine,
  };
}

/**
 * Tên đọc cho vùng chạm của thẻ thành viên / thẻ Điểm Xanh. Chứa đủ chữ đang hiển thị (tên, hạng, điểm, giá trị quy đổi) rồi mới tới
 * hành động, để trình đọc màn hình và lệnh giọng nói khớp với những gì khách thấy.
 */
export function memberCardAriaLabel(card: Pick<MemberCardView, 'tierName' | 'pointsLabel' | 'valueLabel'>, action: string, greeting?: string): string {
  const who = [greeting, card.tierName].filter(Boolean).join(' · ');
  return [who, card.pointsLabel, card.valueLabel].filter(Boolean).join(', ') + `. ${action}`;
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

// ---- Nhớ số dòng "Việc cần làm" ----

export interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const TODO_ROWS_KEY = 'tubu_home_todo_rows';

/** Số dòng "Việc cần làm" lần mở trước của CHÍNH tài khoản này (0, 1 hoặc 2). Sai dạng, khác tài khoản hay không có kho → 0. */
export function readTodoRows(storage: MemoryStorage | null, userId: string | null | undefined): number {
  if (!storage || !userId) return 0;
  try {
    const v = JSON.parse(storage.getItem(TODO_ROWS_KEY) ?? 'null') as { userId?: unknown; rows?: unknown } | null;
    return v && v.userId === userId && (v.rows === 1 || v.rows === 2) ? v.rows : 0;
  } catch {
    return 0;
  }
}

export function writeTodoRows(storage: MemoryStorage | null, userId: string, rows: number): void {
  try {
    storage?.setItem(TODO_ROWS_KEY, JSON.stringify({ userId, rows: Math.min(2, Math.max(0, rows)) }));
  } catch {
    /* hết quota / bị chặn: lần sau không có khung chờ, khối vẫn đúng */
  }
}

/** Số dòng đã nhớ của tài khoản dùng gần nhất (bất kể là ai): để dựng khung chờ trong lúc còn khôi phục phiên. */
export function readLastTodoRows(storage: MemoryStorage | null): number {
  if (!storage) return 0;
  try {
    const v = JSON.parse(storage.getItem(TODO_ROWS_KEY) ?? 'null') as { rows?: unknown } | null;
    return v && (v.rows === 1 || v.rows === 2) ? v.rows : 0;
  } catch {
    return 0;
  }
}

/** Chiều cao khung chờ của "Việc cần làm" cho số dòng đã nhớ: mỗi dòng 60px cộng phần đệm của thẻ. */
export const todoSkeletonHeight = (rows: number): number => rows * 60 + 18;
