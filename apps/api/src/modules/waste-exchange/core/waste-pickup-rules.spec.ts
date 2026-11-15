import { BadRequestException } from '@nestjs/common';
import { assertPickupItemsAllowedForProvince, isHcmProvince, PICKUP_BATTERY_HCM_ONLY_MESSAGE } from './waste-pickup-rules';

describe('isHcmProvince', () => {
  it.each(['Thành phố Hồ Chí Minh', 'TP. Hồ Chí Minh', 'TP.HCM', 'tp hcm', 'Hồ Chí Minh', 'Ho Chi Minh City', 'THÀNH PHỐ HỒ CHÍ MINH', ' Sài Gòn '])(
    'nhận %s',
    (v) => expect(isHcmProvince(v)).toBe(true),
  );

  it.each(['Hà Nội', 'Bình Dương', 'Thành phố Thủ Đức', 'Đồng Nai', 'Tỉnh Hồ Chí Minh Xa', '', null, undefined])('từ chối %s', (v) =>
    expect(isHcmProvince(v as string | null | undefined)).toBe(false),
  );
});

describe('assertPickupItemsAllowedForProvince', () => {
  it('Pin cũ ở tỉnh khác bị chặn đúng câu thông báo', () => {
    expect(() => assertPickupItemsAllowedForProvince([{ hazardous: true }], 'Hà Nội')).toThrow(new BadRequestException(PICKUP_BATTERY_HCM_ONLY_MESSAGE));
  });

  it('Pin cũ ở TP.HCM được nhận', () => {
    expect(() => assertPickupItemsAllowedForProvince([{ hazardous: true }], 'Thành phố Hồ Chí Minh')).not.toThrow();
  });

  it('hàng thường nhận ở mọi tỉnh', () => {
    expect(() => assertPickupItemsAllowedForProvince([{ hazardous: false }], 'Hà Nội')).not.toThrow();
  });

  it('thiếu tỉnh với Pin cũ bị chặn', () => {
    expect(() => assertPickupItemsAllowedForProvince([{ hazardous: true }], undefined)).toThrow(BadRequestException);
  });
});
