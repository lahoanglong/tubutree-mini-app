import { vnd } from '@tubutree/app-core/commerce/money';
import { isoToVnLocal, vnLocalToIso } from './admin-campaign-form';
import type { AdminBundle, AdminBundleInput, AdminBundleKind } from './admin-bundles-client';

/** Khớp trần ở API (`bundle-admin-rules.ts`): máy chủ vẫn kiểm lại, số này chỉ để báo lỗi sớm ở form. */
export const BUNDLE_PCT_MAX_PRODUCTS = 6;
export const ADDON_MAX_ITEMS = 3;
export const BUNDLE_MAX_QTY = 10;

export interface BundleDraftItem {
  productId: string;
  name: string;
  /** Phân loại ghim của món: bắt buộc với món mua kèm (chọn ngay khi thêm); combo giảm % chỉ có khi sửa bộ có sẵn, form không đổi được nhưng gửi lại nguyên. */
  variationId: string | null;
  variationName: string | null;
  /** Giá đang bán nếu đã biết (món của bộ có sẵn); món vừa chọn chưa có, máy chủ kiểm sau. */
  price: number | null;
  /** Giá tham chiếu máy chủ đã giữ cho món mua kèm của bộ có sẵn (trần khoản giảm); món vừa chọn chưa có (máy chủ lấy giá đang bán lúc lưu). */
  refPrice: number | null;
  /** Giá kèm đã lưu của món (bộ có sẵn): `refPrice` chỉ còn hiệu lực khi ô giá kèm vẫn bằng số này (xem `keptRefPrice`). */
  savedAddonPrice: number | null;
  /** Chữ gõ trong ô: để rỗng thì báo lỗi thay vì ngầm hiểu là 0đ. */
  addonPrice: string;
  maxQty: string;
}

export interface BundleDraft {
  kind: AdminBundleKind;
  title: string;
  pct: string;
  anchor: { id: string; name: string } | null;
  items: BundleDraftItem[];
  /** "yyyy-mm-ddTHH:mm" giờ Việt Nam, đúng định dạng của VnDateTimeInput. */
  startAt: string;
  endAt: string;
  sortOrder: string;
  isActive: boolean;
}

export const emptyBundleDraft = (kind: AdminBundleKind): BundleDraft => ({
  kind, title: '', pct: kind === 'BUNDLE_PCT' ? '10' : '', anchor: null, items: [], startAt: '', endAt: '', sortOrder: '0', isActive: true,
});

export function draftFromBundle(b: AdminBundle): BundleDraft {
  return {
    kind: b.kind,
    title: b.title,
    pct: b.pct === null ? '' : String(b.pct),
    anchor: b.anchorProductId ? { id: b.anchorProductId, name: b.anchorProductName ?? '' } : null,
    items: b.items.map((i) => ({
      productId: i.productId,
      name: i.productName,
      variationId: i.variationId,
      variationName: i.variationName,
      price: i.price,
      refPrice: i.refPrice,
      savedAddonPrice: i.addonPrice,
      addonPrice: i.addonPrice === null ? '' : String(i.addonPrice),
      maxQty: String(i.maxQty),
    })),
    startAt: isoToVnLocal(b.startAt),
    endAt: isoToVnLocal(b.endAt),
    sortOrder: String(b.sortOrder),
    isActive: b.isActive,
  };
}

type AddonPriceFields = Pick<BundleDraftItem, 'price' | 'refPrice' | 'savedAddonPrice' | 'addonPrice'>;

/**
 * Giá tham chiếu máy chủ SẼ giữ nếu lưu bây giờ: cùng luật `keptRefPrices` ở API (món không đổi giá kèm thì giữ, đổi giá kèm thì máy chủ
 * lấy lại giá đang bán). Món đã đổi sản phẩm hay phân loại là một dòng mới của form nên không mang `refPrice` nào.
 */
export const keptRefPrice = (i: AddonPriceFields): number | null =>
  i.refPrice !== null && i.savedAddonPrice !== null && /^\d+$/.test(i.addonPrice.trim()) && Number(i.addonPrice) === i.savedAddonPrice ? i.refPrice : null;

/**
 * Giá làm cơ sở khoản giảm của món mua kèm sau khi lưu: giỏ chỉ giảm tối đa `min(giá đang bán, giá tham chiếu) − giá kèm` (`addonUnitDiscount`
 * ở API), nên phân loại tăng giá sau khi tạo không làm khoản giảm lớn lên, nhưng sửa giá kèm thì trần được đặt lại theo giá đang bán.
 * null khi chưa biết giá đang bán (món vừa chọn).
 */
export const addonBasePrice = (i: AddonPriceFields): number | null => {
  if (i.price === null) return null;
  const ref = keptRefPrice(i);
  return ref === null ? i.price : Math.min(i.price, ref);
};

const isIntText = (s: string): boolean => /^\d+$/.test(s.trim());
const fail = (error: string) => ({ ok: false as const, error });

/**
 * Bản nháp của form thành thân gửi API, hoặc câu lỗi tiếng Việt đầu tiên. Giờ nhập là giờ Việt Nam (đổi sang ISO +07:00 bất kể múi giờ máy admin).
 * Chỉ báo lỗi sớm các luật hình thức; trần % theo cấu hình, giá kèm so với giá hiện tại của món mới chọn và hạn mức nhân viên do máy chủ quyết.
 */
export function buildBundleInput(d: BundleDraft): { ok: true; input: AdminBundleInput } | { ok: false; error: string } {
  const title = d.title.trim();
  if (!title) return fail('Nhập tên bộ.');
  const startAt = vnLocalToIso(d.startAt);
  const endAt = vnLocalToIso(d.endAt);
  if (!startAt || !endAt) return fail('Chọn đủ ngày và giờ bắt đầu, kết thúc.');
  if (Date.parse(endAt) <= Date.parse(startAt)) return fail('Giờ kết thúc phải sau giờ bắt đầu.');
  if (!isIntText(d.sortOrder) || Number(d.sortOrder) > 9999) return fail('Thứ tự là số nguyên từ 0 đến 9999.');

  const distinct = new Set(d.items.map((i) => i.productId)).size;
  if (distinct !== d.items.length) return fail('Mỗi sản phẩm chỉ xuất hiện một lần trong bộ.');
  for (const i of d.items) {
    if (!isIntText(i.maxQty) || Number(i.maxQty) < 1 || Number(i.maxQty) > BUNDLE_MAX_QTY) return fail(`Số lượng được ưu đãi mỗi đơn của từng món từ 1 đến ${BUNDLE_MAX_QTY}.`);
  }

  const common = { kind: d.kind, title, startAt, endAt, isActive: d.isActive, sortOrder: Number(d.sortOrder) };
  if (d.kind === 'BUNDLE_PCT') {
    if (d.items.length < 2) return fail('Combo cần ít nhất 2 sản phẩm khác nhau.');
    if (d.items.length > BUNDLE_PCT_MAX_PRODUCTS) return fail(`Combo có tối đa ${BUNDLE_PCT_MAX_PRODUCTS} sản phẩm.`);
    if (!isIntText(d.pct) || Number(d.pct) < 1 || Number(d.pct) > 100) return fail('Nhập % giảm là số nguyên từ 1 đến 100.');
    return {
      ok: true,
      input: { ...common, pct: Number(d.pct), items: d.items.map((i) => ({ productId: i.productId, ...(i.variationId ? { variationId: i.variationId } : {}), maxQty: Number(i.maxQty) })) },
    };
  }

  if (!d.anchor) return fail('Chọn sản phẩm chính cho bộ mua kèm.');
  if (d.items.length < 1) return fail('Thêm ít nhất 1 món mua kèm.');
  if (d.items.length > ADDON_MAX_ITEMS) return fail(`Bộ mua kèm có tối đa ${ADDON_MAX_ITEMS} món.`);
  const anchorId = d.anchor.id;
  if (d.items.some((i) => i.productId === anchorId)) return fail('Món mua kèm phải khác sản phẩm chính.');
  for (const i of d.items) {
    if (!i.variationId) return fail(`Chọn phân loại cho "${i.name}": giá mua kèm chỉ áp cho đúng phân loại đó.`);
    if (!isIntText(i.addonPrice)) return fail(`Nhập giá mua kèm cho "${i.name}" (số nguyên từ 0 đồng trở lên).`);
    if (i.price !== null && Number(i.addonPrice) >= i.price) return fail(`Giá mua kèm của "${i.name}" phải thấp hơn giá đang bán (${vnd(i.price)}).`);
  }
  return {
    ok: true,
    input: {
      ...common,
      anchorProductId: anchorId,
      items: d.items.map((i) => ({ productId: i.productId, ...(i.variationId ? { variationId: i.variationId } : {}), addonPrice: Number(i.addonPrice), maxQty: Number(i.maxQty) })),
    },
  };
}
