import { parseMemberCode } from '../modules/loyalty/loyalty.service';
import { OrderReversalService } from '../modules/orders/order-reversal.service';
import { normalizeZaloPhone, parseTypedVnPhone, parseVnPhoneStrict, toLocalPhone } from './phone';

type Out = string | null;

/**
 * Bốn nơi từng chép tay quy tắc "SĐT về dạng nội địa 0xxxxxxxxx", nhưng chỉ có 3 hành vi khác nhau
 * (bảng ROWS bên dưới được đo trên bản chép tay cũ trước khi gom):
 *  - zalo: số Zalo trả về, bỏ mọi ký tự không phải số, thêm 0 đầu nếu thiếu, bắt buộc 0 + 9 số.
 *  - strict (loyalty/parseMemberCode): chuỗi gõ/quét ở quầy, chỉ nhận +?<số>, KHÔNG tự thêm 0 đầu.
 *  - loose (affiliate và order-reversal, hai bản giống hệt): khoá gộp khách, chỉ bỏ ký tự không phải số
 *    và đổi 84+9 số thành 0+9 số, KHÔNG kiểm độ dài.
 */
const zalo = (raw: string): Out => normalizeZaloPhone(raw);

/** Qua parseMemberCode nên khoảng trắng/gạch/chấm đã bị bỏ trước khi chuẩn hoá (đúng đường chạy thật ở quầy). */
const strict = (raw: string): Out => {
  try {
    return parseMemberCode(raw).phone;
  } catch {
    return null; // không phải SĐT cũng không phải mã thành viên
  }
};

const looseAffiliate = (raw: string): Out => toLocalPhone(raw);

/** Đường hoàn tiền đơn hộ: SĐT lấy từ snapshot địa chỉ khi đơn không có endCustomerKey. */
const looseReversal = async (raw: string): Promise<Out> => {
  const create = jest.fn().mockResolvedValue({});
  const tx = { user: { findUnique: jest.fn().mockResolvedValue(null) }, orderCustomerRefund: { create } };
  const order = {
    id: 'o1',
    code: 'TUBU1',
    total: 1000,
    status: 'PAID',
    userId: 'ctv',
    referrerUserId: 'ctv',
    endCustomerKey: null,
    shippingAddress: { phone: raw, recipient: 'A' },
  };
  await (OrderReversalService.prototype as unknown as {
    refundEndCustomer(t: unknown, o: unknown): Promise<unknown>;
  }).refundEndCustomer.call({ logger: { warn: jest.fn() } }, tx, order);
  return (create.mock.calls[0]![0] as { data: { phone: Out } }).data.phone;
};

// [đầu vào, zalo, strict, loose]. strict đi qua parseMemberCode nên khoảng trắng/gạch/chấm đã bị bỏ trước khi chuẩn hoá.
const ROWS: [string, Out, Out, Out][] = [
  ['0912345678', '0912345678', '0912345678', '0912345678'],
  ['+84912345678', '0912345678', '0912345678', '0912345678'],
  ['84912345678', '0912345678', '0912345678', '0912345678'],
  ['+0912345678', '0912345678', '0912345678', '0912345678'],
  ['912345678', '0912345678', null, '912345678'],
  ['0912 345 678', '0912345678', '0912345678', '0912345678'],
  ['090-123 4567', '0901234567', '0901234567', '0901234567'],
  ['+84 912 345 678', '0912345678', '0912345678', '0912345678'],
  ['tel: 0912345678', '0912345678', null, '0912345678'],
  ['', null, null, null],
  ['abc', null, null, null],
  ['84123', null, null, '84123'],
  ['12345', null, null, '12345'],
  ['8412345678', null, null, '8412345678'],
  ['849123456789', null, null, '849123456789'],
  ['02412345678', null, null, '02412345678'],
  ['0912345678901', null, null, '0912345678901'],
];

describe('chuẩn hoá SĐT (đặc tả hành vi từng nơi)', () => {
  it.each(ROWS)('zalo: %j → %j', (raw, expected) => {
    expect(zalo(raw)).toBe(expected);
  });

  it('zalo: thiếu số (undefined/null) → null', () => {
    expect(normalizeZaloPhone(undefined)).toBeNull();
    expect(normalizeZaloPhone(null)).toBeNull();
  });

  it.each(ROWS)('strict (loyalty/parseMemberCode): %j → %j', (raw, _zalo, expected) => {
    expect(strict(raw)).toBe(expected);
  });

  it.each(ROWS)('loose (affiliate): %j → %j', (raw, _zalo, _strict, expected) => {
    expect(looseAffiliate(raw)).toBe(expected);
  });

  it.each(ROWS)('loose (order-reversal, hoàn tiền đơn hộ): %j → %j', async (raw, _zalo, _strict, expected) => {
    expect(await looseReversal(raw)).toBe(expected);
  });

  // parseMemberCode bỏ khoảng trắng/gạch/chấm trước khi gọi, nên hàm strict trần phải tự từ chối chúng.
  it.each([
    ['0912345678', '0912345678'],
    ['+84912345678', '0912345678'],
    ['84912345678', '0912345678'],
    ['912345678', null],
    ['0912 345 678', null],
    ['090-123-4567', null],
    ['', null],
    ['84123', null],
  ])('parseVnPhoneStrict trần: %j → %j', (raw, expected) => {
    expect(parseVnPhoneStrict(raw)).toBe(expected);
  });
});

// R5-CHECKOUT-2: SĐT người nhận CTV gõ tay ở form lên đơn hộ. Nhận cả dạng có dấu cách/chấm/gạch, nhưng không tự thêm 0 cho
// dãy 9 số (từng lọt qua chặn "SĐT của chính CTV" vì '922222221' không trùng '0922222221').
describe('parseTypedVnPhone (SĐT người nhận gõ tay)', () => {
  it.each([
    ['0922222221', '0922222221'],
    ['+84922222221', '0922222221'],
    ['84922222221', '0922222221'],
    ['+84 92 222 2221', '0922222221'],
    ['092.222.2221', '0922222221'],
    ['092-222-2221', '0922222221'],
    ['  0922 222 221  ', '0922222221'],
    ['(+84) 922 222 221', '0922222221'],
  ])('%j → %j', (raw, expected) => {
    expect(parseTypedVnPhone(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['922222221'],
    ['0922 222 22'],
    ['09222222211'],
    ['+840922222221'],
    ['8492222222'],
    ['tel: 0922222221'],
    ['0922222221a'],
    ['+0922222221'],
    ['---'],
    ['0012345678'],
    ['+84012345678'],
  ])('%j → null', (raw) => {
    expect(parseTypedVnPhone(raw)).toBeNull();
  });
});
