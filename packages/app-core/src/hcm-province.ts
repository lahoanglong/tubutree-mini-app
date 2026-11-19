/** Bỏ dấu, hạ chữ thường, gộp mọi ký tự không phải chữ/số thành một khoảng trắng (bản sao của máy chủ waste-pickup-rules). */
function fold(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Tỉnh/thành của địa chỉ là TP. Hồ Chí Minh. Chỉ để báo sớm cho khách; máy chủ vẫn là nơi chặn thật.
 * Bản sao của `isHcmProvince` ở `apps/api/.../waste-pickup-rules.ts` (app-core không import được mã Nest); spec dùng đúng bảng ca của spec bên API.
 */
export function isHcmProvince(province: string | null | undefined): boolean {
  if (!province) return false;
  const text = fold(province);
  return /^(thanh pho |tp )?(ho chi minh|hcm|hochiminh)( city)?$/.test(text) || text === 'sai gon';
}
