import type { ProductCard } from '../api/catalog';
import type { CouponDTO } from '../api/loyalty';
import { productCardView, type ProductCardView } from './product-card-view';
import { voucherView, type VoucherFlags, type VoucherView } from './voucher';

/**
 * Dữ liệu giả cho trang `/ds-gallery` (chỉ bản dev của Mini App và web). Cả hai app đọc cùng file này nên hai bản gallery
 * có chữ và số giống hệt, so được số đo ở 375px. Không có URL mạng: ảnh là SVG data-URI.
 */

const H = 3_600_000;
const DAY = 24 * H;

/** 12:00 ngày 01/11/2026 giờ Việt Nam. Chữ hạn dùng của mã và nhãn "Mới" của món tính theo mốc này nên không đổi theo ngày chạy. */
export const GALLERY_NOW = Date.UTC(2026, 10, 1, 5, 0, 0);

/** Mốc kết thúc cho `Countdown`: tính từ đồng hồ thật (mặc định) vì `Countdown` đọc giờ thật, mốc cố định sẽ luôn là quá khứ. */
export function galleryEnd(offsetMs: number, now: number = Date.now()): string {
  return new Date(now + offsetMs).toISOString();
}

const svg = (from: string, to: string, shape: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="1000" height="400" fill="url(#g)"/>${shape}</svg>`,
  )}`;

export interface GallerySlide {
  id: string;
  image: string;
  alt: string;
  href: string;
}

export const GALLERY_SLIDES: GallerySlide[] = [
  { id: 'cam', image: svg('#F59E0B', '#EA580C', '<circle cx="820" cy="120" r="150" fill="#FFFFFF" fill-opacity="0.18"/><circle cx="700" cy="330" r="90" fill="#FFFFFF" fill-opacity="0.12"/>'), alt: 'Giảm 20% mỹ phẩm thuần chay', href: '/ds-gallery' },
  { id: 'la', image: svg('#4D7C0F', '#14532D', '<rect x="640" y="60" width="240" height="240" rx="48" fill="#FFFFFF" fill-opacity="0.16"/>'), alt: 'Đổi rác lấy quà xanh', href: '/ds-gallery' },
  { id: 'nau', image: svg('#78350F', '#431407', '<circle cx="180" cy="300" r="170" fill="#FFFFFF" fill-opacity="0.12"/><circle cx="860" cy="90" r="80" fill="#FFFFFF" fill-opacity="0.2"/>'), alt: 'Giờ vàng 20:00 mỗi tối', href: '/ds-gallery' },
];

const coupon = (code: string, over: Partial<CouponDTO & VoucherFlags> = {}): VoucherView =>
  voucherView({ code, type: 'PERCENT', value: 10, minOrder: 199_000, maxDiscount: 30_000, endAt: new Date(GALLERY_NOW + 10 * DAY).toISOString(), ...over }, GALLERY_NOW);

export interface GalleryVoucher {
  id: string;
  view: VoucherView;
  expiring?: boolean;
  reason?: string;
}

const gv = (code: string, over: Partial<CouponDTO & VoucherFlags> = {}, extra: { expiring?: boolean; reason?: string } = {}): GalleryVoucher => ({
  id: code,
  view: coupon(code, over),
  ...extra,
});

/** Đủ 3 loại (discount, freeship, shop) và 6 trạng thái (collectable, saved, used, expired, soldout, ineligible). */
export const GALLERY_VOUCHERS: GalleryVoucher[] = [
  gv('TUBU10', { claimed: false }),
  gv('FREESHIP', { type: 'FREESHIP', value: 0, minOrder: 99_000, maxDiscount: null, endAt: new Date(GALLERY_NOW + 2 * DAY).toISOString(), claimed: true }, { expiring: true }),
  gv('SHOP50K', { type: 'AMOUNT', value: 50_000, minOrder: 300_000, maxDiscount: null, endAt: new Date(GALLERY_NOW + 20 * DAY).toISOString(), claimed: false, shop: true }),
  gv('DAUTHANG', { type: 'AMOUNT', value: 20_000, minOrder: null, maxDiscount: null, claimed: true, used: true }),
  gv('HETHAN', { endAt: new Date(GALLERY_NOW - H).toISOString(), claimed: true }),
  gv('HETLUOT', { type: 'FREESHIP', value: 0, minOrder: 149_000, maxDiscount: null, claimed: false, soldOut: true }),
  gv('CHUADU', { value: 15, minOrder: 500_000, maxDiscount: 60_000, claimed: true, ineligible: true }, { reason: 'Mua thêm 120k để dùng' }),
  gv('SHOP10', { claimed: true, shop: true }),
];

const card = (over: Partial<ProductCard> & Pick<ProductCard, 'id' | 'slug' | 'name' | 'basePrice'>): ProductCardView & { thumbnail: string | null } => ({
  ...productCardView({
    product: { brand: 'Tubu', thumbnail: null, salePrice: null, isFeatured: false, inStock: true, ...over },
    variant: 'line',
    now: GALLERY_NOW,
  }),
  thumbnail: over.thumbnail ?? null,
});

const thumb = (color: string) => svg(color, '#FFFFFF', '<circle cx="500" cy="200" r="130" fill="#FFFFFF" fill-opacity="0.5"/>');

/** Món của combo: có món hết hàng, tên rất dài, hai món có ảnh và ba món không ảnh. */
export const GALLERY_COMBO_ITEMS: (ProductCardView & { thumbnail: string | null })[] = [
  card({ id: 'g1', slug: 'sua-tam', name: 'Sữa tắm lá bạc hà', basePrice: 52_000, thumbnail: thumb('#BBF7D0') }),
  card({ id: 'g2', slug: 'nuoc-giat', name: 'Nước giặt hữu cơ hương oải hương, chai 2 lít cho cả gia đình', basePrice: 189_000, salePrice: 159_000, thumbnail: thumb('#DDD6FE') }),
  card({ id: 'g3', slug: 'xa-phong', name: 'Xà phòng thảo mộc', basePrice: 35_000 }),
  card({ id: 'g4', slug: 'khan-lau', name: 'Khăn lau đa năng', basePrice: 45_000, inStock: false }),
  card({ id: 'g5', slug: 'binh-xit', name: 'Bình xịt vệ sinh', basePrice: 79_000 }),
];

/** Tổng lẻ và tổng sau giảm của một bộ, làm tròn nghìn như API làm; chỉ dùng cho dữ liệu giả. */
export function galleryCombo(items: { price: number }[], pct: number): { total: number; comboTotal: number } {
  const total = items.reduce((s, i) => s + i.price, 0);
  return { total, comboTotal: Math.round((total * (100 - pct)) / 100 / 1000) * 1000 };
}

export const GALLERY_SORT_OPTIONS: { value: string; label: string; spoken?: string }[] = [
  { value: 'popular', label: 'Phổ biến' },
  { value: 'new', label: 'Mới nhất' },
  { value: 'best', label: 'Bán chạy' },
  { value: 'price', label: 'Giá ⇅', spoken: 'Giá, đổi chiều sắp xếp' },
];
