import { BadRequestException } from '@nestjs/common';

export const PICKUP_BATTERY_HCM_ONLY_MESSAGE =
  'Pin cũ cần xử lý an toàn riêng nên hiện chỉ nhận tại điểm thu gom hoặc lấy tận nơi khu vực TP.HCM';

/** Bỏ dấu, hạ chữ thường, gộp mọi ký tự không phải chữ/số thành một khoảng trắng. */
function fold(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Tỉnh/thành của địa chỉ khách là TP. Hồ Chí Minh. Địa chỉ 2 cấp ghi "Thành phố Hồ Chí Minh"; dữ liệu cũ hay
 * viết "TP. Hồ Chí Minh", "TP.HCM", "Hồ Chí Minh", "Ho Chi Minh City". Không khớp "Hồ Chí Minh" nằm lẫn trong địa chỉ tỉnh khác.
 */
export function isHcmProvince(province: string | null | undefined): boolean {
  if (!province) return false;
  const text = fold(province);
  return /^(thanh pho |tp )?(ho chi minh|hcm|hochiminh)( city)?$/.test(text) || text === 'sai gon';
}

/** Hàng nguy hại (Pin cũ) chỉ đi kèm đơn / shipper lấy tận nơi khi địa chỉ lấy hàng thuộc TP.HCM. */
export function assertPickupItemsAllowedForProvince(items: ReadonlyArray<{ hazardous: boolean }>, province: string | null | undefined): void {
  if (items.some((i) => i.hazardous) && !isHcmProvince(province)) {
    throw new BadRequestException(PICKUP_BATTERY_HCM_ONLY_MESSAGE);
  }
}
