import { viStorefront } from '../i18n/vi-storefront';

/** Nhãn tin cậy chỉ cho gian hàng admin đã duyệt: tick và "CTV tuyển chọn" là lời cam kết của Tubu Tree, không phải của chủ shop tự gắn. Trang khách và đầu xem trước ở trình dựng dùng chung hàm này. */
export function trustBadgeLabel(sf: { type: 'CTV' | 'BRAND' | 'MERCHANT'; approved?: boolean }): string | null {
  if (!sf.approved) return null;
  if (sf.type === 'MERCHANT') return viStorefront.badgePartner;
  if (sf.type === 'BRAND') return viStorefront.badgeBrand;
  return viStorefront.badgeSelectedCtv;
}
