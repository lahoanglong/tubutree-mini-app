import { ZaloService } from '../modules/auth/zalo.service';
import { AffiliateService } from '../modules/affiliate/affiliate.service';
import { parseMemberCode } from '../modules/loyalty/loyalty.service';
import { OrderReversalService } from '../modules/orders/order-reversal.service';

type Out = string | null;

/**
 * Bốn nơi chép tay quy tắc "SĐT về dạng nội địa 0xxxxxxxxx", nhưng chỉ 3 hành vi khác nhau:
 *  - zalo (zalo.service normalizePhone): số Zalo trả về — bỏ mọi ký tự không phải số, thêm 0 đầu nếu thiếu, bắt buộc 0 + 9 số.
 *  - strict (loyalty normalizeVnPhone, qua parseMemberCode): chuỗi gõ/quét ở quầy — chỉ nhận +?<số>, KHÔNG tự thêm 0 đầu.
 *  - loose (affiliate normalizeToLocalPhone và order-reversal normalizeLocalPhone, hai bản giống hệt):
 *    khoá gộp khách — chỉ bỏ ký tự không phải số và đổi 84+9 số thành 0+9 số, KHÔNG kiểm độ dài.
 */
const zalo = (raw: string): Out =>
  (ZaloService.prototype as unknown as { normalizePhone(r?: string): Out }).normalizePhone.call({}, raw);

const strict = (raw: string): Out => {
  try {
    return parseMemberCode(raw).phone;
  } catch {
    return null; // không phải SĐT cũng không phải mã thành viên
  }
};

const looseAffiliate = (raw: string): Out =>
  (AffiliateService.prototype as unknown as { normalizeToLocalPhone(r: string): Out }).normalizeToLocalPhone.call({}, raw);

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

  it('zalo: không có số → null', () => {
    expect(
      (ZaloService.prototype as unknown as { normalizePhone(r?: string): Out }).normalizePhone.call({}, undefined),
    ).toBeNull();
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
});
