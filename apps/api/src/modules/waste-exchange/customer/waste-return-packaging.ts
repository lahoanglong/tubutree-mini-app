import type { ReturnPackagingLine, ReturnPackagingSuggestion } from '@tubutree/shared-types';
import { foldVietnamese } from '../../catalog/search-text';
import { linePoints } from '../waste-points';

/**
 * Gợi ý gói gửi lại điền sẵn từ đơn đã giao (thẻ ở chi tiết đơn và thẻ "Đổi rác kèm đơn" ở thanh toán). Tắt (mặc định, migration
 * 20261118170000): `GET /waste/return-packaging` trả `suggestion: null` và `pickup-options` không kèm gợi ý. File này không import service
 * nào để `public-config.ts` đọc được khoá mà không kéo theo vùng đổi rác.
 */
export const RETURN_PACKAGING_NUDGE_KEY = 'checkout.return_packaging_nudge_enabled';

/** Bao bì của đơn giao quá ngần này ngày thì thôi gợi ý: khách thường đã bỏ thùng. */
export const RETURN_PACKAGING_WINDOW_DAYS = 60;
/** Gộp bao bì của tối đa ngần này đơn gần nhất. */
export const RETURN_PACKAGING_MAX_ORDERS = 5;
/** Trần số lượng một dòng, bằng ô số của ngăn chọn món ở thanh toán. */
export const RETURN_PACKAGING_QTY_MAX = 999;

/** Mỗi kiện Tubu giao tới một thùng carton; món có nhãn "Trả vỏ đổi điểm" (RETURNABLE_PACKAGING) cho mỗi đơn vị một vỏ. */
export const RETURN_PACKAGING_CODES = { carton: 'CARTON', bottle: 'TUBU_BOTTLE' } as const;

/** Đơn của đại lý hay CTV lên hộ khách: bao bì nằm ở chỗ người nhận, không ở chỗ người mở app. */
const NOT_OWN_PACKAGING_SOURCES: readonly string[] = ['ctv_assisted', 'dealer'];

export interface ReturnPackagingOrder {
  code: string;
  type: string;
  status: string;
  fulfiller: string;
  source: string | null;
  placedForCustomer: boolean;
  deliveredAt: Date | null;
  shippingAddress: unknown;
  items: { variationId: string; productId: string | null; quantity: number }[];
}

/** Món rác trong danh mục, đủ trường để tính điểm và kẹp trần. */
export interface ReturnPackagingItem {
  id: string;
  code: string;
  name: string;
  unitLabel: string;
  unitsPerPoint: number;
  pointsPerGroup: number;
  dailyCapQty: number | null;
  monthlyCapQty: number | null;
  status: string;
  hazardous: boolean;
}

/** Nhãn "Trả vỏ đổi điểm" đã duyệt: cấp sản phẩm (`variationId` null) hoặc cấp một phân loại. */
export interface ReturnableFact {
  productId: string;
  variationId: string | null;
}

/** Mốc còn tính bao bì: muộn hơn cả cửa sổ 60 ngày và lần gửi rác gần nhất (bao bì giao trước lần đó coi như đã gửi hoặc đã bỏ). */
export function returnPackagingSince(now: Date, lastReturnAt: Date | null): Date {
  const windowStart = new Date(now.getTime() - RETURN_PACKAGING_WINDOW_DAYS * 86_400_000);
  return lastReturnAt && lastReturnAt > windowStart ? lastReturnAt : windowStart;
}

/** Đơn bán lẻ khách tự nhận, Tubu giao, đã giao sau mốc `since`. */
export function isOwnDeliveredTubuOrder(o: ReturnPackagingOrder, since: Date): boolean {
  if (o.status !== 'DELIVERED' || o.type !== 'RETAIL' || o.fulfiller !== 'TUBU' || o.placedForCustomer) return false;
  if (o.source && NOT_OWN_PACKAGING_SOURCES.includes(o.source)) return false;
  return !!o.deliveredAt && o.deliveredAt > since;
}

const addressField = (a: unknown, key: string): string => {
  if (typeof a !== 'object' || a === null) return '';
  const v = (a as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
};

/**
 * Đơn giao tới đúng nơi bưu tá sẽ lấy rác của đơn mới: cùng số nhà/đường (gấp dấu, bỏ khoảng trắng thừa) và cùng phường/xã (mã nếu cả hai
 * bên có, không thì tên). Thiếu số nhà/đường thì không coi là cùng nơi.
 */
export function sameDeliveryPlace(snapshot: unknown, address: { street: string; ward: string; wardCode: string }): boolean {
  const street = foldVietnamese(addressField(snapshot, 'street'));
  if (!street || street !== foldVietnamese(address.street ?? '')) return false;
  const wardCode = addressField(snapshot, 'wardCode');
  if (wardCode && address.wardCode) return wardCode === address.wardCode;
  return foldVietnamese(addressField(snapshot, 'ward')) === foldVietnamese(address.ward ?? '');
}

/** Số vỏ trả lại được của các dòng: dòng có nhãn cấp sản phẩm, hoặc nhãn đúng phân loại của dòng. */
export function returnableUnits(items: ReturnPackagingOrder['items'], facts: readonly ReturnableFact[]): number {
  return items.reduce((sum, it) => {
    if (!it.productId || it.quantity <= 0) return sum;
    const hit = facts.some((f) => f.productId === it.productId && (f.variationId === null || f.variationId === it.variationId));
    return hit ? sum + it.quantity : sum;
  }, 0);
}

function packagingLine(item: ReturnPackagingItem | undefined, qty: number): ReturnPackagingLine | null {
  if (!item || item.status !== 'ACTIVE' || item.hazardous || item.unitsPerPoint <= 0 || qty <= 0) return null;
  const caps = [item.dailyCapQty, item.monthlyCapQty, RETURN_PACKAGING_QTY_MAX].filter((c): c is number => typeof c === 'number' && c > 0);
  return {
    itemId: item.id,
    code: item.code,
    name: item.name,
    unitLabel: item.unitLabel,
    qty: Math.min(qty, ...caps),
    unitsPerPoint: item.unitsPerPoint,
    pointsPerGroup: item.pointsPerGroup,
  };
}

/**
 * Gói gửi lại của các đơn (đã lọc, mới giao trước): một thùng carton mỗi đơn, một vỏ Tubu Tree mỗi đơn vị món có nhãn "Trả vỏ đổi điểm".
 * Món tắt, món nguy hại hay thiếu trong danh mục thì bỏ dòng; số lượng kẹp theo trần ngày/tháng của món. null khi không còn dòng nào.
 */
export function buildReturnPackaging(
  orders: readonly ReturnPackagingOrder[],
  facts: readonly ReturnableFact[],
  itemsByCode: ReadonlyMap<string, ReturnPackagingItem>,
  minPoints: number,
): ReturnPackagingSuggestion | null {
  if (orders.length === 0) return null;
  const bottles = orders.reduce((sum, o) => sum + returnableUnits(o.items, facts), 0);
  const lines = [
    packagingLine(itemsByCode.get(RETURN_PACKAGING_CODES.carton), orders.length),
    packagingLine(itemsByCode.get(RETURN_PACKAGING_CODES.bottle), bottles),
  ].filter((l): l is ReturnPackagingLine => l !== null);
  if (lines.length === 0) return null;
  const estimatedPoints = lines.reduce((sum, l) => sum + linePoints(l.qty, { ...l, dropsPerUnit: 0, gramsPerUnit: null }), 0);
  return { orderCodes: orders.map((o) => o.code), lines, estimatedPoints, minPoints };
}
