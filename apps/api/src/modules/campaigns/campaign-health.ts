import type { CampaignAudience, CampaignLinkType, CampaignPlacement } from '@prisma/client';
import { CAMPAIGN_LEGACY_SLUG_MAX, CAMPAIGN_SLIDES_MAX } from '@tubutree/shared-types';
import { compareBannerOrder } from './campaign-public';

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

/** Khách mới thấy ALL + NEW, khách cũ thấy ALL + RETURNING; chiến dịch ALL phải nằm trong 5 slide của cả hai cách nhìn. */
const viewsOf = (a: CampaignAudience): readonly ('NEW' | 'RETURNING')[] => (a === 'ALL' ? ['NEW', 'RETURNING'] : [a]);

/** Hạng (từ 1) của chiến dịch trong carousel của khách xấu nhất, hoặc null khi vẫn trong 5 slide đầu. */
function crowdedRank(s: HealthSubject, f: HealthFacts): number | null {
  const self = { id: s.id ?? '￿', sortOrder: s.sortOrder, startAt: s.startAt };
  let worst: number | null = null;
  for (const view of viewsOf(s.audience)) {
    const rivals = f.peers.filter(
      (p) => p.id !== s.id && p.endAt > f.now && p.startAt < s.endAt && s.startAt < p.endAt && (p.audience === 'ALL' || p.audience === view),
    );
    const rank = [self, ...rivals].sort(compareBannerOrder).indexOf(self) + 1;
    if (rank > CAMPAIGN_SLIDES_MAX && (worst === null || rank > worst)) worst = rank;
  }
  return worst;
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
  const early: string[] = [];
  let usable = 0;
  for (const c of f.coupons) {
    if (!c.isActive) off.push(c.code);
    else if (c.endAt <= ref) expired.push(c.code);
    else if (c.usageLimit !== null && c.usedCount >= c.usageLimit) exhausted.push(c.code);
    else {
      usable += 1;
      if (c.endAt < s.endAt) early.push(c.code);
    }
  }
  const issues: HealthIssue[] = [];
  if (off.length) issues.push(issue('WARN', 'COUPON_OFF', `Mã đang tắt nên khách không thấy: ${names(off)}. Bật lại mã hoặc bỏ khỏi chiến dịch.`));
  if (expired.length) issues.push(issue('WARN', 'COUPON_EXPIRED', `Mã đã hết hạn: ${names(expired)}. Gia hạn mã hoặc bỏ khỏi chiến dịch.`));
  if (exhausted.length) issues.push(issue('WARN', 'COUPON_EXHAUSTED', `Mã đã hết lượt dùng: ${names(exhausted)}. Tăng lượt dùng hoặc bỏ khỏi chiến dịch.`));
  if (early.length) issues.push(issue('WARN', 'COUPON_ENDS_EARLY', `Mã hết hạn trước khi chiến dịch kết thúc: ${names(early)}. Gia hạn mã hoặc rút ngắn chiến dịch.`));
  return { usable, issues };
}

/**
 * Kiểm một chiến dịch trước khi bật: thứ khách sẽ gặp mà admin chưa thấy. BLOCK chặn việc bật (lưu nháp tắt vẫn được); WARN chỉ báo.
 * Hàm thuần: dữ kiện (đích, sản phẩm, mã, chiến dịch khác) do bên gọi tra theo lô rồi đưa vào.
 */
export function campaignHealth(s: HealthSubject, f: HealthFacts): HealthIssue[] {
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

  if (s.endAt <= f.now) warns.push(issue('WARN', 'ENDED', 'Ngày kết thúc đã qua nên khách không thấy chiến dịch này. Đổi ngày kết thúc sang tương lai.'));
  const rank = crowdedRank(s, f);
  if (rank !== null) {
    warns.push(
      issue('WARN', 'CROWDED', `Chỗ "${PLACEMENT_LABEL[s.placement]}" có hơn ${CAMPAIGN_SLIDES_MAX} chiến dịch chạy chồng giờ và chiến dịch này xếp thứ ${rank}, nên không hiện. Tắt bớt chiến dịch khác hoặc giảm số thứ tự hiển thị.`),
    );
  }
  warns.push(...coupons.issues);
  const unavailable = f.products.filter((p) => !p.visible || !p.inStock).map((p) => p.name);
  if (unavailable.length) {
    warns.push(issue('WARN', 'PRODUCTS_UNAVAILABLE', `${unavailable.length} sản phẩm gắn kèm đang ẩn hoặc hết hàng: ${names(unavailable)}. Khách không mua được các món này.`));
  }
  return [...blocks, ...warns];
}

export function countHealth(issues: readonly HealthIssue[]): { blockers: number; warnings: number } {
  const blockers = issues.filter((i) => i.level === 'BLOCK').length;
  return { blockers, warnings: issues.length - blockers };
}
