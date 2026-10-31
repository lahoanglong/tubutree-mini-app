import type { CheckInStatusResponse, CouponDTO, LoyaltyOverview } from './api/loyalty';
import { decimalVi, tierProgressPercent } from './loyalty-copy';
import { tileBodyHeight } from './commerce/tile-metrics';

/**
 * Bố cục Trang chủ, thanh đáy, Ưu đãi và hàng trạng thái đơn của trang Cá nhân. Một nguồn cho Mini App và web khổ điện thoại:
 * thứ tự khối, nhãn, mục nào ẩn theo cờ. Mỗi app chỉ gắn biểu tượng và đường dẫn của nền tảng mình.
 */

export type HomeCustomerKind = 'returning' | 'new';
/** Lần mở đầu của khách đã đăng nhập mà app chưa nhớ loại và danh sách đã mua còn đang tải: chưa biết cũ hay mới. */
export type HomeKindState = HomeCustomerKind | 'unknown';

export type HomeBlockId =
  | 'search' | 'member' | 'todo' | 'welcome' | 'banner' | 'shortcuts' | 'purchased' | 'flash' | 'categories' | 'bestSellers' | 'combos'
  | 'journey' | 'community' | 'suggest';

/** Header dính của Trang chủ (logo, ô tìm, chuông, giỏ): thay hàng logo 68px và ô tìm 54px cũ. */
export const HOME_HEADER_HEIGHT = 56;

// "Việc cần làm" có ở cả hai thứ tự: khách chưa có đơn đã giao vẫn có thể đang giữ một đơn chờ chuyển khoản, và khối tự rỗng khi không có việc.
// Màn đầu gọn: header dính, thẻ thành viên (hoặc dải quà) một dòng, banner (tự ẩn khi không có chiến dịch), lối tắt, rồi tới món hàng:
// Giờ vàng đứng TRƯỚC Mua lại để deal nằm trong màn đầu cả với khách cũ (Q6). Thẻ thành viên và dải quà cao bằng nhau (`HOME_HERO_HEIGHT`)
// nên đổi loại khách không làm các khối dưới nhảy. `banner` và `combos` tự ẩn, không giữ chỗ, tới khi P11/P15 có dữ liệu.
const RETURNING: readonly HomeBlockId[] = [
  'search', 'member', 'todo', 'banner', 'shortcuts', 'flash', 'purchased', 'categories', 'bestSellers', 'combos', 'journey', 'community', 'suggest',
];
const NEW: readonly HomeBlockId[] = [
  'search', 'welcome', 'todo', 'banner', 'shortcuts', 'flash', 'categories', 'bestSellers', 'combos', 'journey', 'community', 'suggest',
];

// Chưa biết loại khách: giữ chỗ thẻ thành viên (khối `member` hiện khung chờ) và bỏ các khối chỉ một loại có (Mua lại, Quà khách mới),
// để phần đầu trang không đổi hình dạng khi loại khách được xác định. Bán chạy nhất có ở cả hai loại nên ở lại.
const UNKNOWN: readonly HomeBlockId[] = [
  'search', 'member', 'todo', 'banner', 'shortcuts', 'flash', 'categories', 'bestSellers', 'combos', 'journey', 'community', 'suggest',
];

/** Chiều cao cố định của thẻ thành viên và dải quà khách mới (không tính đệm dưới): hai khối thay chỗ nhau không làm trang nhảy. */
export const HOME_HERO_HEIGHT = 64;

export function homeBlockOrder(kind: HomeKindState): readonly HomeBlockId[] {
  return kind === 'returning' ? RETURNING : kind === 'new' ? NEW : UNKNOWN;
}

/** Khoảng trống giữ chỗ cho mọi khối dưới thẻ thành viên trong lúc loại khách và dữ liệu quyết định chúng chưa về. */
export type HomeRenderBlock = HomeBlockId | 'settling';

/**
 * Thứ tự dựng thật. Khi `settling`, mọi khối dưới thẻ thành viên được thay bằng MỘT khung chờ và chỉ hiện cùng lúc khi dữ liệu đã chốt:
 * dựng từng khối ngay khi dữ liệu của nó về thì khối nào chen vào cũng đẩy các khối đã vẽ xuống (loại khách đổi, Giờ vàng, Mua lại, Việc cần làm).
 */
export function homeRenderOrder(kind: HomeKindState, settling: boolean): readonly HomeRenderBlock[] {
  const order = homeBlockOrder(kind);
  if (!settling) return order;
  const hero = order.findIndex((id) => id === 'member' || id === 'welcome');
  return [...order.slice(0, hero + 1), 'settling'];
}

/**
 * Thứ tự dựng khi máy chủ đã dựng bố cục khách mới (web: HTML đầu luôn là khách vãng lai) rồi khôi phục phiên mới cho biết đây là khách có tài khoản mà
 * máy chưa nhớ loại. Giữ các khối đã vẽ (Giờ vàng, Bán chạy, Gợi ý...) thay vì thay hết bằng khung chờ: chỉ dải quà khách mới đổi thành khung giữ
 * chỗ của thẻ thành viên (cùng chiều cao `HOME_HERO_HEIGHT`), khối riêng của khách cũ. Thứ tự khối là của khách mới, không xáo trộn.
 */
export function homeKeptOrder(kind: HomeKindState): readonly HomeBlockId[] {
  return NEW.map((id) => (id === 'welcome' && kind !== 'new' ? 'member' : id));
}

/** Giữ khung chờ tối đa chừng này: mạng chậm hay API lỗi không được giữ trắng cả trang. */
export const HOME_SETTLE_MAX_MS = 4500;

/**
 * Còn phải giữ khung chờ không. Chỉ lần mở mà ngay khung hình đầu chưa biết loại khách (`startedUnknown`: khách mới vào, đổi máy) mới giữ;
 * máy đã nhớ loại khách dựng đúng ngay bằng khung chờ theo từng khối. Giữ tới khi biết loại khách VÀ dữ liệu quyết định hình dạng
 * (`dataPending` = Việc cần làm, Giờ vàng, Danh mục còn tải) đã về. Bán chạy không chờ: khối có khung chờ cao đúng thẻ thật, và tải sớm
 * thì thêm một lời gọi `/products` cho khách cũ.
 */
export function homeSettling(opts: { startedUnknown: boolean; kind: HomeKindState; dataPending: boolean }): boolean {
  return opts.startedUnknown && (opts.kind === 'unknown' || opts.dataPending);
}

/**
 * Loại khách để chọn thứ tự khối. Chưa đăng nhập hẳn là khách mới. Đang khôi phục phiên (`authPending`) chưa biết là ai: dùng loại đã nhớ của
 * tài khoản dùng gần nhất trên máy (`stored`); chưa nhớ thì "chưa biết" khi `unknownWhenUnremembered` (cả Mini và web đều truyền true,
 * để thẻ thành viên giữ chỗ thay vì dựng bố cục khách mới rồi đổi), còn không là khách mới. Đã đăng nhập: có số liệu đã mua (kể cả cũ, sau một
 * lần tải lại lỗi) thì theo số liệu, chưa có thì theo loại đã nhớ của chính tài khoản này, kể cả khi tải lỗi: khách cũ không bị đẩy về
 * bố cục khách mới vì một lần API chập chờn. Chưa nhớ gì: đang tải là "chưa biết", lỗi là khách mới.
 */
export function resolveHomeKind(opts: {
  authed: boolean;
  /** Đang khôi phục phiên (chưa biết đăng nhập hay chưa). */
  authPending?: boolean;
  /** Đang khôi phục phiên và máy chưa nhớ loại: true = "chưa biết" (giữ chỗ thẻ thành viên), mặc định = khách mới. */
  unknownWhenUnremembered?: boolean;
  /** Loại đã nhớ: của chính tài khoản khi đã đăng nhập, của tài khoản dùng gần nhất khi đang khôi phục phiên. */
  stored: HomeCustomerKind | null;
  /** Số sản phẩm đã mua trong dữ liệu đang có; undefined = chưa có dữ liệu. */
  purchasedCount: number | undefined;
  pending: boolean;
}): HomeKindState {
  if (opts.authPending && !opts.authed) return opts.stored ?? (opts.unknownWhenUnremembered ? 'unknown' : 'new');
  if (!opts.authed) return 'new';
  if (opts.purchasedCount !== undefined) return customerKind(opts.purchasedCount);
  if (opts.stored) return opts.stored;
  return opts.pending ? 'unknown' : 'new';
}

/** Khách cũ = đã nhận ít nhất một sản phẩm (kệ Mua lại có hàng). Đang tải hoặc API cũ 404 thì coi là khách mới. */
export function customerKind(purchasedCount: number | undefined): HomeCustomerKind {
  return (purchasedCount ?? 0) > 0 ? 'returning' : 'new';
}

// ---- Lối tắt ----

export type HomeShortcutId = 'flash' | 'orders' | 'rewards' | 'recycle' | 'groupBuy' | 'coupons' | 'claim' | 'earn' | 'community';
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
  /** Khách còn yêu cầu đổi rác đang mở: mục Đổi rác vẫn hiện (ghi "Yêu cầu") dù chương trình tạm dừng. */
  recycleOpenRequests?: boolean;
}

export const RECYCLE_REQUESTS_LABEL = 'Yêu cầu của tôi';
/** Nhãn lối tắt Trang chủ (ô 5 cột, một dòng): ngắn hơn tên đầy đủ, câu đọc vẫn là tên đầy đủ. */
export const RECYCLE_REQUESTS_SHORTCUT_LABEL = 'Yêu cầu';

// Thứ tự = thứ tự ưu tiên: 4 mục đầu là 4 ô cố định (Q7), phần còn lại nằm trong sheet "Tất cả".
export const HOME_SHORTCUTS: readonly HomeShortcutSpec[] = [
  { id: 'flash', label: 'Giờ vàng', ariaLabel: 'Giờ vàng, ưu đãi có hạn', tint: 'amber' },
  { id: 'coupons', label: 'Mã giảm giá', ariaLabel: 'Mã giảm giá của tôi và mã đang phát', tint: 'rose' },
  { id: 'recycle', label: 'Đổi rác', ariaLabel: 'Đổi rác lấy quà', tint: 'sage', flag: 'waste' },
  { id: 'groupBuy', label: 'Mua chung', ariaLabel: 'Mua chung giá tốt', tint: 'amber' },
  { id: 'rewards', label: 'Đổi quà', ariaLabel: 'Đổi quà bằng Điểm Xanh', tint: 'clay' },
  { id: 'orders', label: 'Đơn hàng', ariaLabel: 'Đơn hàng của tôi', tint: 'forest' },
  { id: 'claim', label: 'Đơn sàn', ariaLabel: 'Tích điểm đơn sàn, đơn mua trên sàn khác', tint: 'sky', flag: 'claim' },
  { id: 'earn', label: 'Kiếm tiền', ariaLabel: 'Kiếm tiền cùng Tubu', tint: 'amber' },
  { id: 'community', label: 'Cộng đồng', ariaLabel: 'Cộng đồng hỏi đáp', tint: 'sky' },
];

/**
 * Mục còn hiển thị theo thứ tự ưu tiên, không có Vườn Xanh (đã là tab giữa của thanh đáy). Mục có cờ tắt bị bỏ, hàng tự dồn. Riêng Đổi rác: chương trình tạm dừng mà khách còn yêu cầu đang mở thì vẫn hiện,
 * đổi nhãn thành "Yêu cầu" để khách còn vào theo dõi, không hứa tính năng đang tạm dừng.
 */
export function visibleHomeShortcuts(flags: HomeFlags): HomeShortcutSpec[] {
  return HOME_SHORTCUTS.flatMap((s): HomeShortcutSpec[] => {
    if (s.flag === 'waste') {
      if (flags.wasteEnabled) return [s];
      return flags.recycleOpenRequests ? [{ ...s, label: RECYCLE_REQUESTS_SHORTCUT_LABEL, ariaLabel: 'Yêu cầu của tôi về đổi rác' }] : [];
    }
    if (s.flag === 'claim') return flags.claimEnabled ? [s] : [];
    return [s];
  });
}

/** Số ô lối tắt cố định ở Trang chủ; còn lại vào sheet "Tất cả" (Q7). */
export const HOME_SHORTCUT_SLOTS = 4;

/** `pinned` = 4 ô cố định (mục cờ tắt bị bỏ thì mục kế lấp chỗ); `all` = mọi mục còn hiển thị, cho sheet "Tất cả". */
export function homeShortcutSlots(flags: HomeFlags): { pinned: HomeShortcutSpec[]; all: HomeShortcutSpec[] } {
  const all = visibleHomeShortcuts(flags);
  return { pinned: all.slice(0, HOME_SHORTCUT_SLOTS), all };
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

export const moneyShort = (n: number) => (n >= 1_000_000 ? `${decimalVi(n / 1_000_000)} triệu` : `${num(n)}đ`);

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
export const SUGGEST_PAGE_SIZE = 20;

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

/** Khoá loại khách (`{ userId, kind }`) mà cả hai app nhớ cho khung chờ Trang chủ. */
export const HOME_KIND_KEY = 'tubu_home_kind';

export interface RemovableStorage extends MemoryStorage {
  removeItem(key: string): void;
}

/** Đăng xuất: không còn tài khoản nào dùng gợi ý khung chờ, bỏ cả hai khoá. */
export function clearHomeHints(storage: RemovableStorage | null): void {
  if (!storage) return;
  for (const key of [HOME_KIND_KEY, TODO_ROWS_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      /* kho bị chặn: không có gì để bỏ */
    }
  }
}

/**
 * Gợi ý khung chờ (loại khách, số dòng Việc cần làm) là của tài khoản dùng gần nhất trên máy và được đọc cả khi chưa biết đang là ai
 * (lúc khôi phục phiên). Khi đăng nhập hay khôi phục ra một tài khoản KHÁC thì phải bỏ gợi ý của người trước ngay, kẻo khung chờ
 * lần mở sau dựng theo loại khách của họ. Trả true khi đã bỏ ít nhất một khoá (web dùng để xoá luôn cookie gợi ý).
 * Giá trị không đọc được hoặc không ghi chủ tài khoản cũng bỏ: không biết là của ai thì không được dùng cho ai.
 */
export function dropForeignHomeHints(storage: RemovableStorage | null, userId: string | null | undefined): boolean {
  if (!storage || !userId) return false;
  let dropped = false;
  for (const key of [HOME_KIND_KEY, TODO_ROWS_KEY]) {
    try {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      let owner: unknown;
      try {
        owner = (JSON.parse(raw) as { userId?: unknown } | null)?.userId;
      } catch {
        owner = undefined;
      }
      if (owner !== userId) {
        storage.removeItem(key);
        dropped = true;
      }
    } catch {
      /* kho bị chặn: không có gì để bỏ */
    }
  }
  return dropped;
}

/** Chiều cao khung chờ của "Việc cần làm" cho số dòng đã nhớ: mỗi việc một dòng 64px; khoảng cách giữa khối do vỏ khối giữ. */
export const todoSkeletonHeight = (rows: number): number => rows * 64;

/** Kệ Bán chạy nhất lấy dư 2 món so với tối đa 10 của kệ để đủ sau khi bỏ món đã nằm ở kệ trên; theo lượt bán 30 ngày. Khớp HOME_BEST_SELLER_LIMIT phía API. */
export const HOME_BEST_SELLER_LIMIT = 12;

/** Khoá nhớ "lần mở trước có Giờ vàng" để dựng khung chờ đúng chỗ; chỉ ghi '1' hoặc '0'. */
export const FLASH_HINT_KEY = 'tubu_home_flash';
/** Dòng "suất kế" dưới kệ Giờ vàng. */
export const FLASH_NEXT_SLOT_HEIGHT = 44;

// '0' không có, '1' có Giờ vàng, '2' có Giờ vàng và dòng suất kế (khung chờ phải cao thêm `FLASH_NEXT_SLOT_HEIGHT`).
function readFlashHintValue(storage: MemoryStorage | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(FLASH_HINT_KEY);
  } catch {
    return null;
  }
}

/** Lần mở trước có suất Giờ vàng đang chạy không. Chưa nhớ hay không có kho → false (chờ im lặng, không giữ chỗ). */
export function readFlashHint(storage: MemoryStorage | null): boolean {
  const v = readFlashHintValue(storage);
  return v === '1' || v === '2';
}

/** Lần mở trước Giờ vàng có kèm dòng suất kế không (chỉ có nghĩa khi `readFlashHint` đúng). */
export function readFlashSlotHint(storage: MemoryStorage | null): boolean {
  return readFlashHintValue(storage) === '2';
}

export function writeFlashHint(storage: MemoryStorage | null, hasFlash: boolean, hasNextSlot = false): void {
  try {
    storage?.setItem(FLASH_HINT_KEY, hasFlash ? (hasNextSlot ? '2' : '1') : '0');
  } catch {
    /* kho bị chặn: lần sau không giữ chỗ, khối vẫn đúng */
  }
}

/** Khoá nhớ số món Mua lại lần mở trước ('one' | 'many'), để khung chờ có đúng chiều cao dòng 88px hay kệ nhiều món. */
export const PURCHASED_HINT_KEY = 'tubu_home_purchased';
export type PurchasedHint = 'none' | 'one' | 'many';

/** Chưa nhớ, kho bị chặn hay giá trị lạ → 'none' (không giữ chỗ, chờ im lặng). */
export function readPurchasedHint(storage: MemoryStorage | null): PurchasedHint {
  if (!storage) return 'none';
  try {
    const v = storage.getItem(PURCHASED_HINT_KEY);
    return v === 'one' || v === 'many' ? v : 'none';
  } catch {
    return 'none';
  }
}

export function writePurchasedHint(storage: MemoryStorage | null, count: number): void {
  try {
    storage?.setItem(PURCHASED_HINT_KEY, count >= 2 ? 'many' : count === 1 ? 'one' : 'none');
  } catch {
    /* kho bị chặn: lần sau không giữ chỗ, khối vẫn đúng */
  }
}

/** Chiều cao dòng Mua lại (1 món) và hàng tiêu đề khối (`--section-header-h`). */
export const PURCHASED_LINE_HEIGHT = 88;
export const SECTION_HEADER_HEIGHT = 44;
/** Đệm trên và dưới của kệ ngang (`--rail-pad-block` = 8) và bề rộng ảnh thẻ `rail-md` (`--tile-w-md`). */
const RAIL_PAD = 8;
const TILE_MD_WIDTH = 148;

/** Chiều cao khung chờ của khối Mua lại theo gợi ý nhớ: tiêu đề + một dòng 88, hay tiêu đề + kệ thẻ `rail-md`. */
export function purchasedSkeletonHeight(hint: PurchasedHint): number {
  if (hint === 'one') return SECTION_HEADER_HEIGHT + PURCHASED_LINE_HEIGHT;
  if (hint === 'many') return SECTION_HEADER_HEIGHT + RAIL_PAD * 2 + TILE_MD_WIDTH + tileBodyHeight('rail-md');
  return 0;
}

/** Chiều cao khối Giờ vàng chưa có dòng suất kế (đo thật Mini 375px: tiêu đề + một hàng thẻ). Khoảng cách tới khối kế do vỏ khối lo nên khung chờ cao đúng bằng số này. */
export const FLASH_SKELETON_HEIGHT = 296;

/**
 * Chiều cao bốn ô của khung chờ chung Trang chủ (`HomeSettlingSkeleton`): một hàng lối tắt, một khối cỡ Giờ vàng, danh mục lưới 2×5, rồi một kệ Bán chạy nhất.
 * Mini App và web dùng chung để khung chờ thay bằng khối thật không làm trang nhảy; đổi chiều cao khối thật thì sửa ở đây (số đo Mini 375px).
 */
export const HOME_SETTLING_HEIGHTS = {
  shortcuts: 84,
  flash: FLASH_SKELETON_HEIGHT,
  categories: 248,
  products: 298,
} as const;
