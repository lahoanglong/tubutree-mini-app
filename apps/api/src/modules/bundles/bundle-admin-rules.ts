import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { formatVnd } from '../orders/refund-destination';
import type { StaffCouponCaps } from '../admin/coupon-input-rules';
import { partnerGoodsError, isPartnerOwnedProduct } from '../cart/partner-goods';
import { cardPrices } from '../catalog/variation-order';
import { isPublicProduct } from '../catalog/public-product';
import { BUNDLE_MIN_PRODUCTS, bundleExposure } from './bundle-rules';

export const BUNDLE_PCT_MAX_PRODUCTS = 6;
export const ADDON_MAX_ITEMS = 3;
export const BUNDLE_MAX_QTY = 10;

export type BundleStatus = 'live' | 'scheduled' | 'ended' | 'off';
export type BundleKindValue = 'BUNDLE_PCT' | 'ADDON';

export interface BundleItemInput {
  productId: string;
  variationId?: string | null;
  addonPrice?: number | null;
  maxQty?: number | null;
}

export interface BundleContentInput {
  kind: BundleKindValue;
  pct?: number | null;
  anchorProductId?: string | null;
  items: readonly BundleItemInput[];
}

/** Nội dung đã chuẩn hoá: mọi trường có giá trị cuối cùng, `sortOrder` theo thứ tự gửi lên. */
export interface BundleContent {
  kind: BundleKindValue;
  pct: number | null;
  anchorProductId: string | null;
  items: { productId: string; variationId: string | null; addonPrice: number | null; maxQty: number; sortOrder: number }[];
}

export interface CatalogProduct {
  id: string;
  name: string;
  isActive: boolean;
  approvalStatus: string;
  storefrontId: string | null;
  basePrice: number;
  salePrice: number | null;
  /** Chỉ phân loại đang bán. */
  variations: { id: string; sku: string; retailPrice: number; salePrice: number | null; stock: number }[];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Luật hình thức của nội dung bộ (THUẦN): số món, % trong trần `bundle.max_pct`, giá kèm nguyên không âm, `maxQty` 1..10.
 * BUNDLE_PCT bỏ `anchorProductId`; ADDON không nhận `pct`.
 */
export function normalizeBundleContent(input: BundleContentInput, maxPct: number): BundleContent {
  const items = input.items.map((it, sortOrder) => ({
    productId: it.productId,
    variationId: it.variationId ?? null,
    addonPrice: it.addonPrice ?? null,
    maxQty: it.maxQty ?? 1,
    sortOrder,
  }));
  if (new Set(items.map((i) => i.productId)).size !== items.length) throw new BadRequestException('Mỗi sản phẩm chỉ xuất hiện một lần trong bộ.');
  if (items.some((i) => !isInt(i.maxQty) || i.maxQty < 1 || i.maxQty > BUNDLE_MAX_QTY)) {
    throw new BadRequestException(`Số lượng được hưởng ưu đãi mỗi đơn của từng món từ 1 đến ${BUNDLE_MAX_QTY}.`);
  }

  if (input.kind === 'BUNDLE_PCT') {
    const pct = input.pct ?? null;
    if (!isInt(pct) || pct < 1 || pct > Math.min(maxPct, 100)) throw new BadRequestException(`Combo giảm từ 1% đến ${maxPct}% mỗi món.`);
    if (items.length < BUNDLE_MIN_PRODUCTS || items.length > BUNDLE_PCT_MAX_PRODUCTS) {
      throw new BadRequestException(`Combo cần từ ${BUNDLE_MIN_PRODUCTS} đến ${BUNDLE_PCT_MAX_PRODUCTS} sản phẩm khác nhau.`);
    }
    if (items.some((i) => i.addonPrice !== null)) throw new BadRequestException('Combo giảm % không đặt giá mua kèm.');
    return { kind: 'BUNDLE_PCT', pct, anchorProductId: null, items };
  }

  if (input.pct != null) throw new BadRequestException('Mua kèm đặt giá kèm cho từng món, không đặt %.');
  const anchor = input.anchorProductId ?? null;
  if (!anchor) throw new BadRequestException('Chọn sản phẩm chính cho bộ mua kèm.');
  if (items.length < 1 || items.length > ADDON_MAX_ITEMS) throw new BadRequestException(`Bộ mua kèm có từ 1 đến ${ADDON_MAX_ITEMS} món.`);
  if (items.some((i) => i.productId === anchor)) throw new BadRequestException('Món mua kèm phải khác sản phẩm chính.');
  if (items.some((i) => !isInt(i.addonPrice) || i.addonPrice < 0)) {
    throw new BadRequestException('Nhập giá mua kèm cho mọi món (số nguyên từ 0 đồng trở lên).');
  }
  // Giá kèm là một con số cố định: không ghim phân loại thì khách chọn phân loại đắt hơn vẫn được giá đó (giảm hàng trăm nghìn).
  if (items.some((i) => !i.variationId)) throw new BadRequestException('Chọn phân loại cho từng món mua kèm: giá kèm chỉ áp cho đúng phân loại đó.');
  return { kind: 'ADDON', pct: null, anchorProductId: anchor, items };
}

export function assertBundleWindow(startAt: Date, endAt: Date): void {
  if (!(endAt.getTime() > startAt.getTime())) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu.');
}

/** Cùng ranh giới với `bundleLiveWhere`: đúng lúc `startAt` là đang chạy, đúng lúc `endAt` là đã kết thúc. */
export function bundleStatus(b: { isActive: boolean; startAt: Date; endAt: Date }, now: Date): BundleStatus {
  if (!b.isActive) return 'off';
  if (b.startAt > now) return 'scheduled';
  if (b.endAt <= now) return 'ended';
  return 'live';
}

function sellable(products: ReadonlyMap<string, CatalogProduct>, id: string): CatalogProduct {
  const p = products.get(id);
  if (!p) throw new BadRequestException(`Không tìm thấy sản phẩm (mã ${id}).`);
  if (!isPublicProduct(p)) throw new BadRequestException(`Sản phẩm "${p.name}" chưa được duyệt hoặc đã ngừng bán.`);
  if (isPartnerOwnedProduct(p)) throw partnerGoodsError('COMBO', p.name);
  return p;
}

/** Giá đang bán của một món trong bộ, theo hai nghĩa: để so với giá kèm (`price`) và để tính thiệt hại tối đa (`maxPrice`). */
export interface ResolvedBundleItem {
  /** Phân loại ghim, hoặc phân loại đại diện của sản phẩm (món không ghim): đúng thứ thẻ và trang chi tiết hiện. */
  price: number;
  /**
   * Giá cao nhất mà một dòng giỏ của món này có thể mang: phân loại ghim thì chính nó; món không ghim (chỉ BUNDLE_PCT) thì phân
   * loại ĐẮT NHẤT đang bán, vì giảm % áp cho mọi phân loại khách chọn chứ không riêng phân loại đại diện (rẻ nhất).
   */
  maxPrice: number;
  /** Chỉ có sau `capAtRefPrices` khi giá tham chiếu giữ lại thấp hơn giá đang bán: `price` đã bị kẹp về đó, lời báo trần phải nói đúng cơ sở. */
  cappedAt?: number;
}

const effective = (v: { retailPrice: number; salePrice: number | null }) => v.salePrice ?? v.retailPrice;

/**
 * Luật theo dữ liệu catalog đã đọc: món và sản phẩm chính phải đang bán, đã duyệt, không phải hàng đối tác; `variationId` thuộc đúng
 * sản phẩm và còn bán; giá kèm phải thấp hơn giá đang bán của phân loại ghim (không thì bộ không giảm được đồng nào). Trả giá của từng
 * món theo thứ tự `content.items`.
 */
export function resolveBundleItems(content: BundleContent, products: ReadonlyMap<string, CatalogProduct>): ResolvedBundleItem[] {
  if (content.anchorProductId) sellable(products, content.anchorProductId);
  return content.items.map((it) => {
    const p = sellable(products, it.productId);
    let price: number;
    let maxPrice: number;
    if (it.variationId) {
      const v = p.variations.find((x) => x.id === it.variationId);
      if (!v) throw new BadRequestException(`Món "${p.name}" ghim phân loại không còn bán hoặc không thuộc sản phẩm này.`);
      price = effective(v);
      maxPrice = price;
    } else {
      const c = cardPrices(p, p.variations);
      price = c.salePrice ?? c.basePrice;
      maxPrice = Math.max(price, ...p.variations.map(effective));
    }
    if (content.kind === 'ADDON' && (it.addonPrice ?? 0) >= price) {
      throw new BadRequestException(`Giá mua kèm của "${p.name}" phải thấp hơn giá đang bán (${formatVnd(price)}).`);
    }
    return { price, maxPrice };
  });
}

/** Món ADDON đang lưu của bộ, đủ để nhận ra món nào không đổi khi sửa. */
export interface StoredBundleItem {
  productId: string;
  variationId: string | null;
  addonPrice: number | null;
  refPrice?: number | null;
}

/**
 * Giá tham chiếu cũ của từng món trong `content` (theo thứ tự `content.items`), chỉ với bộ ADDON: món có cùng sản phẩm, phân loại và giá kèm
 * với món đang lưu thì giữ giá tham chiếu cũ. Form sửa luôn gửi lại cả danh sách món (kể cả khi chỉ đổi giờ hay tên), nên nếu không giữ thì
 * mọi lần lưu đều đặt lại trần theo giá hiện tại và khoản giảm đã bị chặn bật lên lại. Món mới, đổi giá kèm, đổi phân loại, hay dòng cũ
 * thiếu giá tham chiếu thì `null`: lấy giá đang bán lúc này (người sửa vừa tự đặt lại giá kèm, hay dòng chưa có trần nào để giữ).
 */
export function keptRefPrices(content: BundleContent, previous: readonly StoredBundleItem[]): (number | null)[] {
  return content.items.map((it) => {
    if (content.kind !== 'ADDON') return null;
    const same = previous.find((p) => p.productId === it.productId && p.variationId === it.variationId && p.addonPrice === it.addonPrice);
    return same?.refPrice ?? null;
  });
}

/**
 * Giá làm cơ sở cho trần nhân viên: giá đang bán nhưng không vượt giá tham chiếu giữ lại, đúng thứ giỏ dùng để tính khoản giảm
 * (`addonUnitDiscount`). Món không có giá tham chiếu giữ lại thì giữ nguyên giá đang bán.
 */
export function capAtRefPrices(resolved: readonly ResolvedBundleItem[], kept: readonly (number | null)[]): ResolvedBundleItem[] {
  return resolved.map((r, i) => {
    const ref = kept[i];
    if (ref == null) return r;
    return { price: Math.min(r.price, ref), maxPrice: Math.min(r.maxPrice, ref), ...(ref < r.price ? { cappedAt: ref } : {}) };
  });
}

/**
 * Trần của nhân viên Marketing (cùng `coupon.staff_*` với mã giảm giá): % giảm mỗi món và số tiền tối đa một đơn được giảm nhờ bộ.
 * Bộ không có quota nên không có trần ngân sách ngày; `maxQty` là thứ giới hạn thiệt hại mỗi đơn. Số tiền tính trên `maxPrice`
 * (phân loại đắt nhất khách có thể chọn), không phải giá phân loại rẻ nhất.
 */
export function assertStaffBundleCaps(content: BundleContent, resolved: readonly ResolvedBundleItem[], caps: StaffCouponCaps): void {
  const deny = (text: string) => new ForbiddenException(`${text} Cần mức cao hơn thì nhờ quản trị viên tạo bộ.`);
  if (content.kind === 'BUNDLE_PCT') {
    if ((content.pct ?? 0) > caps.maxPercent) throw deny(`Nhân viên đặt combo giảm tối đa ${caps.maxPercent}%.`);
  } else {
    content.items.forEach((it, i) => {
      const price = resolved[i]?.price ?? 0;
      if (price > 0 && (price - (it.addonPrice ?? price)) * 100 > caps.maxPercent * price) {
        const cappedAt = resolved[i]?.cappedAt;
        const base = cappedAt === undefined ? 'giá đang bán' : `giá lúc đặt giá kèm (${formatVnd(cappedAt)})`;
        throw deny(`Nhân viên đặt giá mua kèm giảm tối đa ${caps.maxPercent}% so với ${base}.`);
      }
    });
  }
  const exposure = bundleExposure(
    { kind: content.kind, pct: content.pct },
    content.items.map((it, i) => ({ price: resolved[i]?.maxPrice ?? 0, addonPrice: it.addonPrice, maxQty: it.maxQty })),
  );
  if (exposure > caps.maxAmount) {
    throw deny(`Mỗi đơn được giảm tối đa ${formatVnd(caps.maxAmount)} nhờ bộ này (đang là ${formatVnd(exposure)}).`);
  }
}
