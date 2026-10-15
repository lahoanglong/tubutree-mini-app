import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PlaceOrderForCustomerDto } from './place-order-for-customer.dto';

async function errorKeys(plain: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(PlaceOrderForCustomerDto, plain);
  const errs = await validate(dto, { whitelist: true });
  // Gộp cả constraint cấp cha lẫn con (nested) để test dễ khẳng định.
  const walk = (e: import('class-validator').ValidationError[]): string[] =>
    e.flatMap((x) => [...Object.keys(x.constraints ?? {}), ...walk(x.children ?? [])]);
  return walk(errs);
}

const CUSTOMER = {
  recipient: 'Khách A',
  phone: '0900000000',
  province: 'Hà Nội',
  ward: 'Phường 1',
  street: 'Số 1',
  provinceCode: '84_VN01',
  wardCode: '84_VN0101',
};

const VALID = {
  items: [{ variationId: 'v1', quantity: 2 }],
  customer: CUSTOMER,
  paymentMethod: 'COD',
};

describe('PlaceOrderForCustomerDto', () => {
  it('hợp lệ (COD) → không lỗi', async () => {
    expect(await errorKeys(VALID)).toHaveLength(0);
  });

  it('hợp lệ (BANK_TRANSFER) → không lỗi', async () => {
    expect(await errorKeys({ ...VALID, paymentMethod: 'BANK_TRANSFER' })).toHaveLength(0);
  });

  it('items rỗng → lỗi arrayMinSize', async () => {
    expect(await errorKeys({ ...VALID, items: [] })).toContain('arrayMinSize');
  });

  it('quantity 0 → lỗi min (nested)', async () => {
    const keys = await errorKeys({ ...VALID, items: [{ variationId: 'v1', quantity: 0 }] });
    expect(keys).toContain('min');
  });

  it('paymentMethod ngoài COD/BANK_TRANSFER → lỗi isIn (chặn WALLET/XU)', async () => {
    expect(await errorKeys({ ...VALID, paymentMethod: 'WALLET' })).toContain('isIn');
  });

  it('expectedTotal (tổng CTV đã báo khách) là số nguyên không âm, không gửi cũng được', async () => {
    expect(await errorKeys({ ...VALID, expectedTotal: 139000 })).toHaveLength(0);
    expect(await errorKeys({ ...VALID, expectedTotal: -1 })).toContain('min');
    expect(await errorKeys({ ...VALID, expectedTotal: 1.5 })).toContain('isInt');
  });

  it('thiếu recipient trong customer → lỗi (nested)', async () => {
    const keys = await errorKeys({ ...VALID, customer: { ...CUSTOMER, recipient: undefined } });
    expect(keys).toContain('isString');
  });

  // R5-CHECKOUT-2: request tự chế với SĐT/tên rỗng hoặc rác từng tạo đơn kẹt đẩy Pancake (FAILED).
  it.each([
    ['SĐT rỗng', { phone: '' }],
    ['SĐT chữ', { phone: 'abc' }],
    ['SĐT 9 số không có 0 đầu', { phone: '922222221' }],
    ['SĐT thiếu số', { phone: '09222222' }],
    ['tên người nhận rỗng', { recipient: '' }],
    ['tên người nhận toàn khoảng trắng', { recipient: '    ' }],
    ['tên người nhận 1 ký tự', { recipient: ' A ' }],
    ['địa chỉ toàn khoảng trắng', { street: '   ' }],
    ['chưa chọn tỉnh/thành', { provinceCode: '' }],
    ['chưa chọn phường/xã', { wardCode: '' }],
  ])('%s → lỗi', async (_label, over) => {
    expect(await errorKeys({ ...VALID, customer: { ...CUSTOMER, ...over } })).not.toHaveLength(0);
  });

  it.each(['+84 92 222 2221', '84922222221', '092.222.2221', '092-222-2221', '0922222221'])(
    'SĐT %j (0/+84/84, có dấu cách/chấm/gạch) → hợp lệ',
    async (phone) => {
      expect(await errorKeys({ ...VALID, customer: { ...CUSTOMER, phone } })).toHaveLength(0);
    },
  );

  it('tên người nhận và địa chỉ được cắt khoảng trắng hai đầu', async () => {
    const dto = plainToInstance(PlaceOrderForCustomerDto, { ...VALID, customer: { ...CUSTOMER, recipient: '  Nguyễn An ', street: ' 12 Lê Lợi  ' } });
    expect(await validate(dto, { whitelist: true })).toHaveLength(0);
    expect(dto.customer.recipient).toBe('Nguyễn An');
    expect(dto.customer.street).toBe('12 Lê Lợi');
  });
});
