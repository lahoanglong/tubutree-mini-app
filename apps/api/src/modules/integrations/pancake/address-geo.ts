import { BadRequestException } from '@nestjs/common';
import type { GeoService } from './geo.service';
import { isNewGeoCode } from './geo-code';

/** Mã lỗi ổn định để FE mở form sửa địa chỉ (message tiếng Việt có thể đổi câu chữ). */
export const ADDRESS_OUTDATED = 'ADDRESS_OUTDATED';

export const ADDRESS_OUTDATED_MESSAGE =
  'Địa chỉ giao hàng chưa theo địa giới mới (tỉnh/thành và phường/xã sau sắp xếp 2025). Vui lòng cập nhật lại địa chỉ.';
const WARD_MISMATCH_MESSAGE = 'Phường/xã không thuộc tỉnh/thành đã chọn. Vui lòng chọn lại địa chỉ.';

function outdated(message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code: ADDRESS_OUTDATED, message });
}

/**
 * Địa chỉ gửi được sang Pancake: mã tỉnh hệ 2 cấp ("84_VN…") và phường thuộc đúng tỉnh đó theo danh mục
 * Pancake. Danh mục chưa tải được (Pancake lỗi/chưa cấu hình) thì chỉ kiểm hình dạng mã — không chặn khách vì
 * lỗi bên ngoài; đơn sai phường khi đó vẫn bị Pancake từ chối và vào hàng đợi đẩy lại.
 */
export async function assertDeliverableAddress(
  geo: GeoService | undefined,
  a: { provinceCode?: string | null; wardCode?: string | null },
): Promise<void> {
  if (!isNewGeoCode(a.provinceCode) || !a.wardCode?.trim() || a.wardCode === '00') {
    throw outdated(ADDRESS_OUTDATED_MESSAGE);
  }
  if (geo && (await geo.checkWard(a.provinceCode, a.wardCode)) === 'invalid') {
    throw outdated(WARD_MISMATCH_MESSAGE);
  }
}
