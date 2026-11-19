import type { WasteCreateRequest, WasteFeeCashMethod, WasteLineInput, WastePickupQuoteRequest } from '@tubutree/shared-types';
import { isHcmProvince } from './hcm-province';
import { formatVnNumber } from './number-format';

export { isHcmProvince };

/** Chờ khách ngừng đổi địa chỉ / món / số kg rồi mới xin báo phí, để nhiều lần bấm nhanh chỉ tốn một lời gọi. */
export const HOME_PICKUP_QUOTE_DEBOUNCE_MS = 300;

/** Các mức kg gợi ý (gram). Máy chủ nhận mọi số nguyên 500..10000; chip chỉ là lối chọn nhanh. Giữ khớp WASTE_HOME_PICKUP_MIN/MAX_GRAMS (spec kiểm). */
export const HOME_PICKUP_WEIGHT_CHIPS_GRAMS: readonly number[] = [500, 1000, 2000, 3000, 5000, 10_000];

/** Số kg hiện cho khách: 500 → "0,5", 2000 → "2". */
export const homePickupKgLabel = (grams: number): string => formatVnNumber(grams / 1000);

/** Cách "Shipper lấy tận nhà" dùng chung cổng với thu kèm đơn (máy chủ lấy lane pickup), và cũng dừng khi khách bị khoá đường vận chuyển. */
export function homePickupEnabled(args: { cfgPickup: boolean; lanePickup: boolean; shipLocked: boolean }): boolean {
  return args.cfgPickup && args.lanePickup && !args.shipLocked;
}

/** Khối lượng ước theo gramsPerUnit của từng món (món chưa có gram thì không góp). */
export function estimateLinesGrams(lines: readonly WasteLineInput[], items: readonly { id: string; gramsPerUnit: number | null }[]): number {
  return lines.reduce((sum, l) => {
    const g = items.find((i) => i.id === l.itemId)?.gramsPerUnit;
    return sum + (g != null && g > 0 ? g * l.declaredQty : 0);
  }, 0);
}

/** Mức nhỏ nhất không thấp hơn ước lượng; chưa ước lượng được thì 1 kg; vượt mọi mức thì mức lớn nhất. */
export function defaultHomePickupWeight(estimateGrams: number): number {
  if (!(estimateGrams > 0)) return 1000;
  return HOME_PICKUP_WEIGHT_CHIPS_GRAMS.find((g) => g >= estimateGrams) ?? HOME_PICKUP_WEIGHT_CHIPS_GRAMS[HOME_PICKUP_WEIGHT_CHIPS_GRAMS.length - 1]!;
}

/** Có món nguy hại (Pin cũ) trong các dòng đã chọn mà địa chỉ lấy rác không thuộc TP.HCM. */
export function homePickupBatteryBlocked(
  lines: readonly WasteLineInput[],
  items: readonly { id: string; hazardous: boolean }[],
  province: string | null | undefined,
): boolean {
  if (isHcmProvince(province)) return false;
  return lines.some((l) => items.find((i) => i.id === l.itemId)?.hazardous === true);
}

/** Lựa chọn của khách ở khối thu gom tận nhà: địa chỉ, mức cân ước tính và cách trả phần phí thiếu (nếu Điểm Xanh chưa đủ). */
export interface HomePickupForm {
  addressId: string | null;
  weightGrams: number | null;
  payment?: WasteFeeCashMethod | null;
}

export const EMPTY_HOME_PICKUP_FORM: HomePickupForm = { addressId: null, weightGrams: null, payment: null };

/** Địa chỉ được chọn: đúng cái khách chọn nếu còn trong sổ, không thì địa chỉ mặc định, rồi cái đầu tiên. */
export function pickHomePickupAddress<A extends { id: string; isDefault?: boolean }>(addresses: readonly A[], chosenId: string | null): A | null {
  return addresses.find((a) => a.id === chosenId) ?? addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
}

/** Thân báo phí; null khi thiếu địa chỉ, số kg hoặc món (chưa hỏi được). Món xếp theo itemId để cùng thân thì cùng khoá truy vấn. */
export function homePickupQuoteRequest(form: HomePickupForm, lines: readonly WasteLineInput[]): WastePickupQuoteRequest | null {
  if (!form.addressId || form.weightGrams === null || lines.length === 0) return null;
  const sorted = [...lines].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return { addressId: form.addressId, declaredWeightGrams: form.weightGrams, lines: sorted };
}

/** Thân tạo đơn. Luôn gửi `usePointsForShipFee: true`; khi thiếu điểm khách chọn `payment` (Ví Tubu / VietQR) và gửi trần `expectedCashVnd`. */
export function homePickupCreateBody(args: {
  form: HomePickupForm;
  lines: readonly WasteLineInput[];
  consentVersion?: string | null;
  expectedCashVnd?: number | null;
}): WasteCreateRequest | null {
  const { form, lines, consentVersion, expectedCashVnd } = args;
  if (!form.addressId || form.weightGrams === null || lines.length === 0) return null;
  const sorted = [...lines].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return {
    method: 'HOME_PICKUP',
    lines: sorted,
    consent: true,
    ...(consentVersion ? { consentVersion } : {}),
    pickupAddressId: form.addressId,
    declaredWeightGrams: form.weightGrams,
    usePointsForShipFee: true,
    ...(form.payment ? { shipFeePayment: form.payment } : {}),
    ...(form.payment && expectedCashVnd != null && expectedCashVnd > 0 ? { expectedCashVnd } : {}),
  };
}
