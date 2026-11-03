import { errorStatus } from '@tubutree/app-core/api/error-status';
import { vnDateRangeError, vnDateRangeInvalid, vnDayKeyOfIso, vnPromoWindowIso } from '@tubutree/app-core/vn-day';
import { loadErrorText } from './error-text';
import type { BrandSalesPeriod, OwnedPromotion } from '@tubutree/app-core/api/brand-owner';

export const OWNER_FORBIDDEN = 'Tài khoản này không có quyền quản lý thương hiệu.';
const ACTION_FORBIDDEN = 'Bạn không có quyền thực hiện thao tác này.';

/** 403 đổi sang lời dễ hiểu (không lộ "Forbidden resource" của máy chủ); lỗi khác theo loadErrorText. */
export function ownerLoadError(e: unknown): string {
  if (errorStatus(e) === 403) return OWNER_FORBIDDEN;
  return loadErrorText(e);
}
export function ownerActionError(e: unknown): string {
  if (errorStatus(e) === 403) return ACTION_FORBIDDEN;
  return loadErrorText(e);
}

export const SALES_PERIODS: { key: BrandSalesPeriod; label: string }[] = [
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: '90d', label: '90 ngày' },
  { key: 'month', label: 'Tháng này' },
  { key: 'prev_month', label: 'Tháng trước' },
];

export interface PromoForm {
  title: string;
  subtitle: string;
  couponCode: string;
  startAt: string;
  endAt: string;
}
export const EMPTY_PROMO: PromoForm = { title: '', subtitle: '', couponCode: '', startAt: '', endAt: '' };

// Chặn khi cả hai ngày được nhập mà kết thúc < bắt đầu, hoặc chỉ có ngày kết thúc mà nó đã qua (bắt đầu mặc định là bây giờ):
// nếu không, khuyến mãi chết ngay khi lưu.
export function promoDateRangeInvalid(f: PromoForm, now = Date.now()): boolean {
  return vnDateRangeInvalid(f.startAt, f.endAt, now);
}

export function promoDateRangeError(f: PromoForm, now = Date.now()): string | null {
  return vnDateRangeError(f.startAt, f.endAt, now);
}

/** yyyy-mm-dd từ ô ngày → ISO theo giờ VN (đầu ngày / cuối ngày); kết thúc trống = hết ngày VN chứa (bắt đầu + 30 ngày − 1 giây), xem vnPromoWindowIso. */
export function promoPayload(f: PromoForm, now = Date.now()) {
  return {
    title: f.title.trim(),
    subtitle: f.subtitle.trim() || undefined,
    couponCode: f.couponCode.trim().toUpperCase() || undefined,
    ...vnPromoWindowIso(f.startAt, f.endAt, now),
  };
}

export function promoToForm(p: OwnedPromotion): PromoForm {
  return {
    title: p.title,
    subtitle: p.subtitle ?? '',
    couponCode: p.couponCode ?? '',
    startAt: vnDayKeyOfIso(p.startAt),
    endAt: vnDayKeyOfIso(p.endAt),
  };
}
