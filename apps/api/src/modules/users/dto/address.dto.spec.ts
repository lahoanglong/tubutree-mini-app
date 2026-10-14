import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateAddressDto, UpdateAddressDto } from './address.dto';

const VALID = {
  recipient: 'Nguyễn Văn A',
  phone: '0912345678',
  province: 'Hà Nội',
  district: '',
  ward: 'Phường Ba Đình',
  street: '12 Phố Huế',
  provinceCode: '84_VN01',
  districtCode: '',
  wardCode: '84_VN01_00004',
};

const errorsOf = (cls: typeof CreateAddressDto | typeof UpdateAddressDto, body: object) =>
  validateSync(plainToInstance(cls, body)).map((e) => e.property);

describe('CreateAddressDto — API tự kiểm, không tin client (MONEY-12)', () => {
  it('địa chỉ hợp lệ hệ 2 cấp (districtCode rỗng) → qua', () => {
    expect(errorsOf(CreateAddressDto, VALID)).toEqual([]);
    expect(errorsOf(CreateAddressDto, { ...VALID, phone: '+84912345678' })).toEqual([]);
  });

  it.each(['abc', '091234567', '09123456789', '84912345678'])('SĐT "%s" → bị từ chối', (phone) => {
    expect(errorsOf(CreateAddressDto, { ...VALID, phone })).toEqual(['phone']);
  });

  it('tên/địa chỉ chứa thẻ HTML → bị từ chối', () => {
    expect(errorsOf(CreateAddressDto, { ...VALID, recipient: '<script>alert(1)</script>', street: '<b>x</b>' })).toEqual([
      'recipient',
      'street',
    ]);
  });

  it('mã tỉnh cũ ("00", "1", "01") → bị từ chối', () => {
    for (const provinceCode of ['00', '1', '01']) expect(errorsOf(CreateAddressDto, { ...VALID, provinceCode })).toEqual(['provinceCode']);
  });

  it('UpdateAddressDto: chỉ đặt mặc định vẫn qua; gửi SĐT sai thì chặn', () => {
    expect(errorsOf(UpdateAddressDto, { isDefault: true })).toEqual([]);
    expect(errorsOf(UpdateAddressDto, { phone: 'abc' })).toEqual(['phone']);
  });
});
