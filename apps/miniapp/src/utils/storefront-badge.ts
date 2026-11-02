import { vi } from '../i18n/vi';

/** Nhãn tin cậy chỉ cho gian hàng admin đã duyệt: tick và "CTV tuyển chọn" là lời cam kết của Tubu Tree, không phải của chủ shop tự gắn. Trang khách và đầu xem trước ở trình dựng dùng chung hàm này. */
export function trustBadgeLabel(sf: { type: 'CTV' | 'BRAND' | 'MERCHANT'; approved?: boolean }): string | null {
  if (!sf.approved) return null;
  if (sf.type === 'MERCHANT') return vi.storefront.badgePartner;
  if (sf.type === 'BRAND') return vi.storefront.badgeBrand;
  return vi.storefront.badgeSelectedCtv;
}
