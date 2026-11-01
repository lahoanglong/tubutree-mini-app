import type { CampaignBanner, CampaignCouponDTO } from '../api/campaign';
import type { HomeKindState } from '../home-layout';
import { liveRoute } from '../merch/route-fallback';
import { fillCopy } from '../shop-copy';
import { sortVouchers, voucherView, type VoucherView } from './voucher';

/** Carousel hiển thị tối đa chừng này slide: nhiều hơn là khách không xem hết và ảnh nặng. */
export const CAMPAIGN_SLIDES_MAX = 5;
export const CAMPAIGN_PRODUCTS_PAGE = 20;

const VN_OFFSET_MS = 7 * 3_600_000;
const ENTITY_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

/**
 * Đích nội bộ admin được chọn cho banner (route Mini; `web` là route web tương ứng). Danh sách đóng: giá trị tự gõ không dẫn tới
 * đường dẫn nào ngoài app. Trang của gói khác còn chờ (Giờ vàng, Bán chạy, Mã giảm giá) đi qua `liveRoute` nên tự đổi khi trang thật có.
 */
export const CAMPAIGN_INTERNAL_TARGETS: readonly { value: string; label: string; web: string }[] = [
  { value: '/offers', label: 'Ưu đãi', web: '/uu-dai' },
  { value: '/browse', label: 'Danh mục sản phẩm', web: '/san-pham' },
  { value: '/flash-sale', label: 'Giờ vàng', web: '/gio-vang' },
  { value: '/best-sellers', label: 'Bán chạy nhất', web: '/ban-chay' },
  { value: '/vouchers', label: 'Mã giảm giá', web: '/ma-giam-gia' },
  { value: '/group-buy', label: 'Mua chung', web: '/mua-chung' },
  { value: '/rewards', label: 'Đổi quà', web: '/kho-qua' },
];

/**
 * Banner có hiện cho khách này không. `ALL` luôn hiện; `NEW`/`RETURNING` chỉ khi đã biết đúng loại khách (chưa biết thì chỉ `ALL`,
 * nên banner không nhảy khi loại khách được xác định). Thiếu `now` thì bỏ qua lịch: web dựng HTML trước khi biết giờ máy khách.
 */
export function campaignVisible(c: Pick<CampaignBanner, 'audience' | 'startAt' | 'endAt'>, o: { kind: HomeKindState; now?: number }): boolean {
  if (c.audience === 'NEW' && o.kind !== 'new') return false;
  if (c.audience === 'RETURNING' && o.kind !== 'returning') return false;
  if (o.now === undefined) return true;
  return Date.parse(c.startAt) <= o.now && o.now < Date.parse(c.endAt);
}

/** Đường dẫn bấm vào banner; null khi đích không hợp lệ (slide bị bỏ thay vì dẫn tới trang chết). */
export function campaignHref(c: Pick<CampaignBanner, 'slug' | 'linkType' | 'linkValue'>, platform: 'mini' | 'web'): string | null {
  const mini = platform === 'mini';
  switch (c.linkType) {
    case 'CAMPAIGN_PAGE':
      return `${mini ? '/campaign' : '/chien-dich'}/${encodeURIComponent(c.slug)}`;
    case 'PRODUCT':
      return c.linkValue && ENTITY_SLUG.test(c.linkValue) ? `${mini ? '/product' : '/san-pham'}/${c.linkValue}` : null;
    case 'CATEGORY':
      return c.linkValue && ENTITY_SLUG.test(c.linkValue) ? `${mini ? '/browse' : '/san-pham'}?category=${c.linkValue}` : null;
    case 'URL_INTERNAL': {
      const target = CAMPAIGN_INTERNAL_TARGETS.find((t) => t.value === c.linkValue);
      if (!target) return null;
      if (mini) return liveRoute(target.value, 'mini');
      const live = liveRoute(target.value, 'web');
      return live === target.value ? target.web : live;
    }
    default:
      return null;
  }
}

export interface CampaignSlide {
  id: string;
  image: string;
  alt: string;
  href: string;
}

export function campaignSlides(
  list: readonly CampaignBanner[] | null | undefined,
  o: { kind: HomeKindState; platform: 'mini' | 'web'; now?: number },
): CampaignSlide[] {
  const slides: CampaignSlide[] = [];
  for (const c of list ?? []) {
    if (slides.length >= CAMPAIGN_SLIDES_MAX) break;
    if (!campaignVisible(c, o)) continue;
    const href = campaignHref(c, o.platform);
    if (href) slides.push({ id: c.id, image: c.image, alt: c.title, href });
  }
  return slides;
}

function vnDayMonth(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + VN_OFFSET_MS);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "Từ 01/11 đến 11/11", ngày theo giờ Việt Nam; mốc không đọc được thì rỗng. */
export function campaignDateRange(c: Pick<CampaignBanner, 'startAt' | 'endAt'>): string {
  const a = vnDayMonth(c.startAt);
  const b = vnDayMonth(c.endAt);
  return a && b ? fillCopy('campaign.dateRange', { a, b }) : '';
}

/** Mã của chiến dịch dạng thẻ voucher: sắp hết hạn trước. Là mã công khai nên trạng thái luôn "saved" (dùng được ngay), không có nút nhận. */
export function campaignVoucherViews(coupons: readonly CampaignCouponDTO[], now: number): VoucherView[] {
  return sortVouchers([...coupons], now).map((c) => voucherView(c, now));
}
