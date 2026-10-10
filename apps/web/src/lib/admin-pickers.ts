import type {
  AdminDealerTier,
  AdminUser,
  AdminVariationHit,
  AdminVariationLabel,
  SubscriptionStatus,
} from './admin-client';
import { formatVnd } from './shop-client';

export function variationOptionLabel(v: AdminVariationHit): string {
  const parts = [v.name, v.sku, formatVnd(v.price), v.stock > 0 ? `tồn ${v.stock}` : 'hết hàng'];
  if (!v.isActive) parts.push('đang ẩn');
  return parts.join(' · ');
}

/** Nhãn "Sản phẩm · Biến thể (SKU)" cho một Variation ID đã lưu; `fallbackId` dùng khi lookup không thấy (biến thể đã xoá). */
export function variationLabel(v: AdminVariationLabel | undefined, fallbackId = ''): string {
  if (!v) return `Biến thể không còn tồn tại (${fallbackId})`;
  return `${v.productName} · ${v.name} (${v.sku})`;
}

export function userOptionLabel(u: AdminUser): string {
  return `${u.fullName?.trim() || 'Chưa có tên'} · ${u.phone?.trim() || 'chưa có SĐT'}`;
}

export function tierOptionLabel(t: AdminDealerTier): string {
  const credit = t.creditLimit > 0 ? `hạn mức công nợ ${formatVnd(t.creditLimit)}` : 'không cấp công nợ';
  const parts = [t.name, `từ ${formatVnd(t.minOrderVolume)}`, credit];
  if (t.paymentTerms) parts.push(t.paymentTerms);
  return parts.join(' · ');
}

/** Link/video do khách gửi là dữ liệu không tin cậy: chỉ https, không khoảng trắng thừa (javascript:/data: bị bỏ). */
export function safeHttpsLink(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim()) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function reviewStars(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE: 'Đang chạy',
  PAUSED: 'Tạm dừng',
  CANCELLED: 'Đã huỷ',
};
export function subscriptionStatusLabel(status: string): string {
  return SUBSCRIPTION_STATUS_LABELS[status as SubscriptionStatus] ?? status;
}

export const intervalLabel = (weeks: number): string => `${weeks} tuần/lần`;
