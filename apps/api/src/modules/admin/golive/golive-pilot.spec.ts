import { hasPilotMarker, maskPhone, parseTestPhone, pilotMatches, planFor, type PilotOrderShape } from './golive-pilot';

const base: PilotOrderShape = {
  code: 'TB1',
  type: 'RETAIL',
  status: 'CONFIRMED',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  total: 64_000,
  createdAt: new Date('2026-11-20T03:00:00Z'),
  note: '[PILOT]',
  guestPhone: null,
  placedForCustomer: false,
  pancakePaidReported: null,
  paymentUnlinkedAt: null,
  user: { phone: '0901234567' },
};
const plan = (patch: Partial<PilotOrderShape>, done = false) => planFor({ ...base, ...patch }, ['NOTE_MARKER'], done).action;

describe('golive-pilot: luật nhận diện và việc sẽ làm', () => {
  it('SĐT người thử: nhận 0/84/+84 + 9 số (bỏ dấu cách, chấm, gạch), không tự thêm số 0', () => {
    expect(parseTestPhone('0901 234 567')).toBe('0901234567');
    expect(parseTestPhone('+84901234567')).toBe('0901234567');
    expect(parseTestPhone('84.901.234.567')).toBe('0901234567');
    expect(parseTestPhone('901234567')).toBeNull();
    expect(parseTestPhone('090123456')).toBeNull();
    expect(parseTestPhone('abc')).toBeNull();
  });

  it('dấu [PILOT] không phân biệt hoa thường; chữ "pilot" trần không tính', () => {
    expect(hasPilotMarker('Đơn thử [pilot] T1')).toBe(true);
    expect(hasPilotMarker('autopilot giao sáng')).toBe(false);
    expect(hasPilotMarker(null)).toBe(false);
  });

  it('khớp SĐT người mua hoặc SĐT khách vãng lai; không SĐT nào gửi kèm thì chỉ còn dấu ghi chú', () => {
    const phones = new Set(['0901234567']);
    const o = { note: null, user: null, guestPhone: null, placedForCustomer: false };
    expect(pilotMatches({ ...o, user: { phone: '0901234567' } }, phones)).toEqual(['TEST_PHONE']);
    expect(pilotMatches({ ...o, guestPhone: '0901234567' }, phones)).toEqual(['TEST_PHONE']);
    expect(pilotMatches({ ...o, note: '[PILOT]', user: { phone: '0901234567' } }, new Set())).toEqual(['NOTE_MARKER']);
    expect(pilotMatches({ ...o, note: 'x', user: { phone: '0977000000' } }, phones)).toEqual([]);
  });

  it('đơn CTV đặt hộ khách thật không bao giờ khớp theo SĐT của CTV; chỉ dấu [PILOT] mới tính', () => {
    const phones = new Set(['0901234567']);
    expect(pilotMatches({ note: null, user: { phone: '0901234567' }, guestPhone: null, placedForCustomer: true }, phones)).toEqual([]);
    expect(pilotMatches({ note: '[PILOT]', user: { phone: '0901234567' }, guestPhone: null, placedForCustomer: true }, phones)).toEqual(['NOTE_MARKER']);
  });

  it('chỉ khớp SĐT (không có [PILOT]): luôn làm tay, kể cả đơn chưa trả tiền hay đơn đã xong', () => {
    for (const status of ['CONFIRMED', 'PENDING_PAYMENT', 'DELIVERED'] as const) {
      expect(planFor({ ...base, note: null, status }, ['TEST_PHONE'], false).action).toBe('MANUAL');
    }
    expect(planFor({ ...base, note: null }, ['TEST_PHONE'], true).action).toBe('DONE');
    expect(planFor(base, ['NOTE_MARKER', 'TEST_PHONE'], false).action).toBe('CANCEL');
  });

  it('chỉ huỷ đơn chờ thanh toán/đã xác nhận chưa có đồng nào; có tiền, đã rời kho, đại lý là làm tay; đơn xong chỉ ghi sổ', () => {
    expect(plan({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' })).toBe('CANCEL');
    expect(plan({ status: 'CONFIRMED' })).toBe('CANCEL');
    expect(plan({ paymentStatus: 'PAID' })).toBe('MANUAL');
    expect(plan({ paymentStatus: 'FAILED' })).toBe('MANUAL');
    expect(plan({ pancakePaidReported: 30_000 })).toBe('MANUAL');
    expect(plan({ paymentUnlinkedAt: new Date() })).toBe('MANUAL');
    expect(plan({ status: 'PACKED' })).toBe('MANUAL');
    expect(plan({ status: 'SHIPPING' })).toBe('MANUAL');
    expect(plan({ type: 'DEALER' })).toBe('MANUAL');
    for (const status of ['DELIVERED', 'CANCELLED', 'RETURNED'] as const) expect(plan({ status, paymentStatus: 'PAID' })).toBe('ARCHIVE');
    expect(plan({ status: 'CONFIRMED' }, true)).toBe('DONE');
  });

  it('che SĐT', () => {
    expect(maskPhone('0901234567')).toBe('090***4567');
    expect(maskPhone(null)).toBeNull();
  });
});
