import { describe, expect, it } from 'vitest';
import { addressPayload, addressToForm, firstInvalidField, isLegacyGeo, validateAddress } from './address-form';

const GEO = { province: 'Hà Nội', provinceCode: '84_VN01', ward: 'Cầu Giấy', wardCode: '84_VN01_001' };
const OK = { recipient: 'Nguyễn An', phone: '0912 345 678', street: '1 Xuân Thuỷ' };

describe('validateAddress — lỗi theo từng ô (BUYERWEB-14)', () => {
  it('đủ và đúng: không có lỗi', () => {
    expect(validateAddress(OK, GEO)).toEqual({});
  });

  it('để trống: mỗi ô một lời nhắc riêng, tiếng Việt có dấu', () => {
    expect(validateAddress({ recipient: '  ', phone: '', street: '' }, { province: '', provinceCode: '', ward: '', wardCode: '' })).toEqual({
      recipient: 'Nhập tên người nhận.',
      phone: 'Nhập số điện thoại.',
      province: 'Chọn tỉnh/thành.',
      ward: 'Chọn phường/xã.',
      street: 'Nhập số nhà, tên đường.',
    });
  });

  it('SĐT sai định dạng được giải thích, không chỉ tắt nút', () => {
    for (const bad of ['091234567', '09123456789', '84912345678', 'abc', '0912-345-678', '+8491234567']) {
      expect(validateAddress({ ...OK, phone: bad }, GEO).phone, bad).toMatch(/^Số điện thoại chưa đúng/);
    }
  });

  it('SĐT đúng: 0xxxxxxxxx hoặc +84xxxxxxxxx, khoảng trắng được bỏ qua', () => {
    for (const good of ['0912345678', '+84912345678', ' 0912 345 678 ']) {
      expect(validateAddress({ ...OK, phone: good }, GEO).phone, good).toBeUndefined();
    }
  });

  it('chọn tỉnh nhưng chưa chọn phường: chỉ báo phường', () => {
    expect(validateAddress(OK, { ...GEO, ward: '', wardCode: '' })).toEqual({ ward: 'Chọn phường/xã.' });
  });

  it('quá độ dài BE cho phép thì báo ngay thay vì nhận 400 chung chung', () => {
    expect(validateAddress({ ...OK, recipient: 'a'.repeat(121) }, GEO).recipient).toMatch(/tối đa 120 ký tự/);
    expect(validateAddress({ ...OK, street: 'a'.repeat(256) }, GEO).street).toMatch(/tối đa 255 ký tự/);
  });
});

describe('firstInvalidField — ô đầu tiên cần đưa con trỏ tới', () => {
  it('theo thứ tự trên màn hình', () => {
    expect(firstInvalidField({ street: 'x', phone: 'y', province: 'z' })).toBe('phone');
    expect(firstInvalidField({ ward: 'x', street: 'y' })).toBe('ward');
    expect(firstInvalidField({})).toBeNull();
  });
});

describe('addressPayload / addressToForm', () => {
  it('payload cắt khoảng trắng, bỏ khoảng trắng trong SĐT, hệ 2 cấp nên quận/huyện rỗng', () => {
    expect(addressPayload({ recipient: ' Nguyễn An ', phone: '0912 345 678', street: ' 1 Xuân Thuỷ ' }, GEO)).toEqual({
      recipient: 'Nguyễn An',
      phone: '0912345678',
      street: '1 Xuân Thuỷ',
      province: 'Hà Nội',
      ward: 'Cầu Giấy',
      district: '',
      provinceCode: '84_VN01',
      wardCode: '84_VN01_001',
      districtCode: '',
    });
  });

  it('đưa địa chỉ đã lưu về form để sửa, giữ mã vùng', () => {
    const saved = {
      id: 'a1', recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy',
      street: '1 Xuân Thuỷ', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_001', isDefault: true,
    };
    expect(addressToForm(saved)).toEqual({ form: OK_FORM(), geo: GEO });
  });

  it('địa chỉ địa giới cũ (mã 00 / mã tỉnh trước 2025): sửa thì bỏ trống tỉnh/phường để chọn lại', () => {
    const legacy = {
      id: 'a2', recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: 'Cầu Giấy', ward: 'Dịch Vọng',
      street: '1 Xuân Thuỷ', provinceCode: '01', districtCode: '005', wardCode: '00', isDefault: false,
    };
    expect(isLegacyGeo(legacy)).toBe(true);
    expect(isLegacyGeo({ provinceCode: '84_VN01', wardCode: '84_VN01_001' })).toBe(false);
    expect(addressToForm(legacy)).toEqual({ form: OK_FORM(), geo: { province: '', provinceCode: '', ward: '', wardCode: '' } });
  });
});

describe('validateAddress — cùng luật với API (MONEY-12)', () => {
  it('tên người nhận / địa chỉ có ký tự < > → báo lỗi trước khi gửi', () => {
    expect(validateAddress({ ...OK, recipient: 'An <b>' }, GEO)).toEqual({ recipient: 'Tên người nhận không được chứa ký tự < hoặc >.' });
    expect(validateAddress({ ...OK, street: '1 <script>' }, GEO)).toEqual({ street: 'Địa chỉ không được chứa ký tự < hoặc >.' });
  });
});

function OK_FORM() {
  return { recipient: 'Nguyễn An', phone: '0912345678', street: '1 Xuân Thuỷ' };
}
