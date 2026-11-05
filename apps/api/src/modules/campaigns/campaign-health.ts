import type { CampaignAudience, CampaignLinkType, CampaignPlacement } from '@prisma/client';
import { CAMPAIGN_LEGACY_SLUG_MAX, CAMPAIGN_SLIDES_MAX } from '@tubutree/shared-types';
import { BANNER_FETCH_LIMIT, compareBannerOrder } from './campaign-public';

export type HealthLevel = 'BLOCK' | 'WARN';
export type HealthCode =
  | 'LINK_PRODUCT_MISSING'
  | 'LINK_PRODUCT_HIDDEN'
  | 'LINK_CATEGORY_MISSING'
  | 'PAGE_EMPTY'
  | 'SLUG_LONG'
  | 'ENDED'
  | 'CROWDED'
  | 'COUPON_OFF'
  | 'COUPON_EXPIRED'
  | 'COUPON_NOT_STARTED'
  | 'COUPON_EXHAUSTED'
  | 'COUPON_ENDS_EARLY'
  | 'PRODUCTS_UNAVAILABLE';

export interface HealthIssue {
  code: HealthCode;
  level: HealthLevel;
  message: string;
}

/** Phần của một chiến dịch (đã lưu hoặc đang soạn) mà các luật kiểm cần. */
export interface HealthSubject {
  id?: string;
  placement: CampaignPlacement;
  audience: CampaignAudience;
  linkType: CampaignLinkType;
  linkValue: string | null;
  startAt: Date;
  endAt: Date;
  sortOrder: number;
}

export interface HealthProduct {
  name: string;
  /** Khách thấy được: đúng điều kiện PUBLIC_PRODUCT_WHERE. */
  visible: boolean;
  inStock: boolean;
}

export interface HealthCoupon {
  code: string;
  isActive: boolean;
  startAt: Date;
  endAt: Date;
  usageLimit: number | null;
  usedCount: number;
}

export interface HealthPeer {
  id: string;
  audience: CampaignAudience;
  startAt: Date;
  endAt: Date;
  sortOrder: number;
  /** Ra được slide ở máy khách (ảnh phục vụ được và đích dựng được link). Thiếu thì coi là có. Vẫn chiếm chỗ trong 10 của API vì API cắt trước khi bỏ chúng. */
  shows?: boolean;
}

export interface HealthFacts {
  now: Date;
  /** Đích PRODUCT/CATEGORY đã tra trong DB; null với đích khác. Danh mục không có cờ ẩn nên `visible` của danh mục luôn bằng `exists`. */
  target: { exists: boolean; visible: boolean } | null;
  products: HealthProduct[];
  coupons: HealthCoupon[];
  /** Chiến dịch BẬT khác cùng vị trí chưa hết hạn. */
  peers: HealthPeer[];
}

const PLACEMENT_LABEL: Record<CampaignPlacement, string> = { HOME_TOP: 'Đầu Trang chủ', OFFERS_TOP: 'Đầu Ưu đãi' };

const issue = (level: HealthLevel, code: HealthCode, message: string): HealthIssue => ({ level, code, message });
const names = (items: readonly string[]) => (items.length > 3 ? `${items.slice(0, 3).join(', ')} và ${items.length - 3} mục khác` : items.join(', '));

/** Khách mới thấy ALL + NEW, khách cũ thấy ALL + RETURNING; chiến dịch ALL phải qua được cả hai cách nhìn. */
const viewsOf = (a: CampaignAudience): readonly ('NEW' | 'RETURNING')[] => (a === 'ALL' ? ['NEW', 'RETURNING'] : [a]);

/**
 * Chiến dịch này có bị khuất khỏi carousel lúc `t` không, theo đúng đường hiển thị thật: API lấy chiến dịch đang chạy, xếp theo compareBannerOrder và cắt
 * BANNER_FETCH_LIMIT (chưa lọc đối tượng, như Mini App bản cũ gọi không kèm audience); máy khách rồi lọc đối tượng và cắt CAMPAIGN_SLIDES_MAX.
 */
function hiddenAt(s: HealthSubject, rivals: readonly HealthPeer[], t: Date): boolean {
  const self: HealthPeer = { id: s.id ?? '\uffff', audience: s.audience, startAt: s.startAt, endAt: s.endAt, sortOrder: s.sortOrder };
  const live = rivals.filter((p) => p.startAt <= t && t < p.endAt);
  const fetched = [self, ...live].sort(compareBannerOrder).slice(0, BANNER_FETCH_LIMIT);
  if (!fetched.includes(self)) return true;
  // API bỏ banner có ảnh không phục vụ được SAU khi cắt 10, và app bỏ banner không dựng được link: hai loại đó chiếm chỗ trong 10 nhưng không thành slide.
  const slides = fetched.filter((x) => x === self || x.shows !== false);
  return viewsOf(s.audience).some((v) => !slides.filter((x) => x.audience === 'ALL' || x.audience === v).slice(0, CAMPAIGN_SLIDES_MAX).includes(self));
}

const vnStamp = (d: Date) => {
  const v = new Date(d.getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}`;
};

/**
 * Thứ hạng chỉ đổi ở các mốc: lúc chiến dịch này bắt đầu chạy (hoặc bây giờ, nếu đã chạy) và lúc một chiến dịch khác bắt đầu hay kết thúc trong khung
 * thời gian của nó. Xét từng mốc; null khi mọi mốc đều hiện.
 */
function crowding(s: HealthSubject, f: HealthFacts): { always: boolean; firstHidden: Date } | null {
  const from = s.startAt > f.now ? s.startAt : f.now;
  if (s.endAt <= from) return null;
  const rivals = f.peers.filter((p) => p.id !== s.id && p.endAt > from && p.startAt < s.endAt);
  const marks = new Set<number>([from.getTime()]);
  for (const p of rivals) {
    for (const t of [p.startAt, p.endAt]) if (t > from && t < s.endAt) marks.add(t.getTime());
  }
  let hidden = 0;
  let first: Date | null = null;
  const sorted = [...marks].sort((a, b) => a - b);
  for (const m of sorted) {
    const t = new Date(m);
    if (hiddenAt(s, rivals, t)) {
      hidden += 1;
      first ??= t;
    }
  }
  return first ? { always: hidden === sorted.length, firstHidden: first } : null;
}

function targetIssues(s: HealthSubject, f: HealthFacts): HealthIssue[] {
  const out: HealthIssue[] = [];
  const value = s.linkValue ?? '';
  if (s.linkType === 'PRODUCT' && f.target) {
    if (!f.target.exists) out.push(issue('BLOCK', 'LINK_PRODUCT_MISSING', `Không có sản phẩm với slug "${value}". Kiểm lại slug hoặc đổi đích.`));
    else if (!f.target.visible) {
      out.push(issue('BLOCK', 'LINK_PRODUCT_HIDDEN', `Sản phẩm "${value}" đang ẩn hoặc chưa được duyệt nên khách bấm banner sẽ vào trang lỗi. Bật hiển thị sản phẩm hoặc đổi đích.`));
    }
  }
  if (s.linkType === 'CATEGORY' && f.target && !f.target.exists) {
    out.push(issue('BLOCK', 'LINK_CATEGORY_MISSING', `Không có danh mục với slug "${value}". Kiểm lại slug danh mục hoặc đổi đích.`));
  }
  if ((s.linkType === 'PRODUCT' || s.linkType === 'CATEGORY') && value.length > CAMPAIGN_LEGACY_SLUG_MAX) {
    out.push(
      issue('WARN', 'SLUG_LONG', `Slug đích dài ${value.length} ký tự, quá ${CAMPAIGN_LEGACY_SLUG_MAX}: Mini App bản cũ sẽ không hiện banner này. Đổi sang đích có slug ngắn hơn hoặc đợi Mini App bản mới.`),
    );
  }
  return out;
}

function couponIssues(s: HealthSubject, f: HealthFacts, ref: Date): { usable: number; issues: HealthIssue[] } {
  const off: string[] = [];
  const expired: string[] = [];
  const exhausted: string[] = [];
  const notStarted: string[] = [];
  const early: string[] = [];
  let usable = 0;
  for (const c of f.coupons) {
    if (!c.isActive) off.push(c.code);
    else if (c.endAt <= ref) expired.push(c.code);
    else if (c.startAt > ref) notStarted.push(c.code);
    else if (c.usageLimit !== null && c.usedCount >= c.usageLimit) exhausted.push(c.code);
    else {
      usable += 1;
      if (c.endAt < s.endAt) early.push(c.code);
    }
  }
  const issues: HealthIssue[] = [];
  if (off.length) issues.push(issue('WARN', 'COUPON_OFF', `Mã đang tắt nên khách không thấy: ${names(off)}. Bật lại mã hoặc bỏ khỏi chiến dịch.`));
  if (expired.length) issues.push(issue('WARN', 'COUPON_EXPIRED', `Mã đã hết hạn: ${names(expired)}. Gia hạn mã hoặc bỏ khỏi chiến dịch.`));
  if (notStarted.length) issues.push(issue('WARN', 'COUPON_NOT_STARTED', `Mã chưa tới giờ mở nên khách chưa dùng được: ${names(notStarted)}. Đổi giờ mở của mã hoặc giờ bắt đầu chiến dịch.`));
  if (exhausted.length) issues.push(issue('WARN', 'COUPON_EXHAUSTED', `Mã đã hết lượt dùng: ${names(exhausted)}. Tăng lượt dùng hoặc bỏ khỏi chiến dịch.`));
  if (early.length) issues.push(issue('WARN', 'COUPON_ENDS_EARLY', `Mã hết hạn trước khi chiến dịch kết thúc: ${names(early)}. Gia hạn mã hoặc rút ngắn chiến dịch.`));
  return { usable, issues };
}

/**
 * Kiểm một chiến dịch trước khi bật: thứ khách sẽ gặp mà admin chưa thấy. BLOCK chặn việc bật (lưu nháp tắt vẫn được); WARN chỉ báo.
 * Hàm thuần: dữ kiện (đích, sản phẩm, mã, chiến dịch khác) do bên gọi tra theo lô rồi đưa vào.
 */
export function campaignHealth(s: HealthSubject, f: HealthFacts): HealthIssue[] {
  // Đã kết thúc thì khách không thấy gì dù đích, trang hay mã ra sao: chỉ báo ngày, không BLOCK/WARN thừa.
  if (s.endAt <= f.now) return [issue('WARN', 'ENDED', 'Ngày kết thúc đã qua nên khách không thấy chiến dịch này. Đổi ngày kết thúc sang tương lai.')];
  const target = targetIssues(s, f);
  const blocks = target.filter((i) => i.level === 'BLOCK');
  const warns = target.filter((i) => i.level === 'WARN');
  // Chiến dịch chưa mở: mã được tính theo lúc chiến dịch mở, vì mã hết hạn trước đó mới là vấn đề.
  const ref = s.startAt > f.now ? s.startAt : f.now;

  const coupons = couponIssues(s, f, ref);
  const visibleProducts = f.products.filter((p) => p.visible);
  if (s.linkType === 'CAMPAIGN_PAGE' && visibleProducts.length === 0 && coupons.usable === 0) {
    blocks.push(issue('BLOCK', 'PAGE_EMPTY', 'Trang chiến dịch đang trống: không có sản phẩm nào khách thấy được và không có mã giảm giá dùng được. Thêm sản phẩm hoặc mã giảm giá trước khi bật.'));
  }

  const crowd = crowding(s, f);
  if (crowd) {
    const where = `Chỗ "${PLACEMENT_LABEL[s.placement]}" chỉ hiện ${CAMPAIGN_SLIDES_MAX} banner đầu theo thứ tự hiển thị.`;
    const fix = 'Tắt bớt chiến dịch khác hoặc giảm số thứ tự hiển thị.';
    warns.push(
      issue(
        'WARN',
        'CROWDED',
        crowd.always
          ? `${where} Chiến dịch này xếp ngoài ${CAMPAIGN_SLIDES_MAX} banner đầu suốt thời gian chạy nên khách không thấy. ${fix}`
          : `${where} Chiến dịch này có lúc xếp ngoài ${CAMPAIGN_SLIDES_MAX} banner đầu, từ ${vnStamp(crowd.firstHidden)} (giờ Việt Nam), nên khi đó khách không thấy. ${fix}`,
      ),
    );
  }
  warns.push(...coupons.issues);
  const unavailable = f.products.filter((p) => !p.visible || !p.inStock).map((p) => p.name);
  if (unavailable.length) {
    warns.push(issue('WARN', 'PRODUCTS_UNAVAILABLE', `${unavailable.length} sản phẩm gắn kèm đang ẩn hoặc hết hàng: ${names(unavailable)}. Khách không mua được các món này.`));
  }
  return [...blocks, ...warns];
}

/** Số món khách dùng được trên trang chiến dịch: sản phẩm khách thấy và mã dùng được (cùng luật với trang trống). Form dựa vào đây để chọn thứ tự gắn. */
export function usableCounts(s: HealthSubject, f: HealthFacts): { products: number; coupons: number } {
  const ref = s.startAt > f.now ? s.startAt : f.now;
  return { products: f.products.filter((p) => p.visible).length, coupons: couponIssues(s, f, ref).usable };
}

export function countHealth(issues: readonly HealthIssue[]): { blockers: number; warnings: number } {
  const blockers = issues.filter((i) => i.level === 'BLOCK').length;
  return { blockers, warnings: issues.length - blockers };
}
