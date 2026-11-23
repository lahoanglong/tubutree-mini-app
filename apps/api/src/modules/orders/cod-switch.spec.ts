import { COD_MAX_PER_ORDER } from '../checkout/checkout-split';
import { PAYMENT_UNLINKED_HOLD_HOURS } from './pending-payment-hold';
import {
  codCap,
  codSwitchEligible,
  codSwitchRefusal,
  codSwitchRefusalMessage,
  inPaymentUnlinkedHold,
  switchedFromTransfer,
  type CodSwitchFacts,
} from './cod-switch';

const NOW = new Date('2026-11-23T10:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const base: CodSwitchFacts = {
  type: 'RETAIL',
  status: 'PENDING_PAYMENT',
  paymentStatus: 'UNPAID',
  paymentMethod: 'BANK_TRANSFER',
  fulfiller: 'TUBU',
  total: 300_000,
  placedForCustomer: false,
  autoCancelBlockedAt: null,
  paymentUnlinkedAt: null,
  paymentUnlinkedFirstAt: null,
  pancakePaidReported: null,
};
const ctx = { attempts: 0, codMax: COD_MAX_PER_ORDER, now: NOW };

describe('codSwitchRefusal', () => {
  it('đơn chuyển khoản chưa trả của kho Tubu: đổi được', () => {
    expect(codSwitchRefusal(base, ctx)).toBeNull();
  });

  it.each<[string, Partial<CodSwitchFacts>, string]>([
    ['đã trả', { paymentStatus: 'PAID', status: 'CONFIRMED' }, 'ALREADY_PAID'],
    ['đã hoàn tiền', { paymentStatus: 'REFUNDED', status: 'CANCELLED' }, 'ALREADY_PAID'],
    ['đã huỷ', { status: 'CANCELLED' }, 'CLOSED'],
    ['đã hoàn hàng', { status: 'RETURNED' }, 'CLOSED'],
    ['đã là COD', { paymentMethod: 'COD', status: 'CONFIRMED' }, 'ALREADY_COD'],
    ['ZaloPay', { paymentMethod: 'ZALOPAY' }, 'NOT_TRANSFER'],
    ['chuyển khoản nhưng không còn chờ tiền', { status: 'CONFIRMED' }, 'NOT_PENDING'],
    ['đơn đại lý', { type: 'DEALER' }, 'NOT_ELIGIBLE'],
    ['gian hàng tự giao', { fulfiller: 'MERCHANT' }, 'NOT_ELIGIBLE'],
    ['CTV đặt hộ', { placedForCustomer: true }, 'NOT_ELIGIBLE'],
    ['quá trần thu hộ', { total: COD_MAX_PER_ORDER + 1 }, 'OVER_MAX'],
    ['đã bàn giao vận chuyển', { autoCancelBlockedAt: hoursAgo(1) }, 'PAYMENT_IN_PROGRESS'],
    ['khoản chưa gắn đơn còn trong giờ chờ', { paymentUnlinkedAt: hoursAgo(1) }, 'PAYMENT_IN_PROGRESS'],
    ['Pancake báo chuyển thiếu', { pancakePaidReported: 1 }, 'PAYMENT_IN_PROGRESS'],
  ])('%s → %s', (_name, over, reason) => {
    expect(codSwitchRefusal({ ...base, ...over }, ctx)).toBe(reason);
  });

  it('đúng trần vẫn đổi được', () => {
    expect(codSwitchRefusal({ ...base, total: COD_MAX_PER_ORDER }, ctx)).toBeNull();
  });

  it('đã mở lệnh thanh toán → PAYMENT_IN_PROGRESS', () => {
    expect(codSwitchRefusal(base, { ...ctx, attempts: 1 })).toBe('PAYMENT_IN_PROGRESS');
  });

  it('trần của người gọi thấp hơn (khách vãng lai) thì áp trần đó; trần cao hơn không vượt COD_MAX_PER_ORDER', () => {
    expect(codSwitchRefusal({ ...base, total: 500_001 }, { ...ctx, codMax: 500_000 })).toBe('OVER_MAX');
    expect(codSwitchRefusal({ ...base, total: 500_000 }, { ...ctx, codMax: 500_000 })).toBeNull();
    expect(codSwitchRefusal({ ...base, total: COD_MAX_PER_ORDER + 1 }, { ...ctx, codMax: COD_MAX_PER_ORDER * 2 })).toBe('OVER_MAX');
    expect(codCap(COD_MAX_PER_ORDER * 2)).toBe(COD_MAX_PER_ORDER);
  });

  it('kết cục rõ cho khách đứng trước rào tiền: đơn đã trả mà quá trần vẫn báo ALREADY_PAID', () => {
    expect(codSwitchRefusal({ ...base, paymentStatus: 'PAID', total: COD_MAX_PER_ORDER * 2 }, ctx)).toBe('ALREADY_PAID');
  });
});

describe('inPaymentUnlinkedHold', () => {
  it('không có khoản chưa gắn đơn: không giữ', () => {
    expect(inPaymentUnlinkedHold({ paymentUnlinkedAt: null, paymentUnlinkedFirstAt: null }, NOW)).toBe(false);
  });

  it('tính từ mốc đầu tiên, thiếu mốc đầu thì lấy paymentUnlinkedAt', () => {
    const inside = hoursAgo(PAYMENT_UNLINKED_HOLD_HOURS - 1);
    const outside = hoursAgo(PAYMENT_UNLINKED_HOLD_HOURS + 1);
    expect(inPaymentUnlinkedHold({ paymentUnlinkedAt: inside, paymentUnlinkedFirstAt: null }, NOW)).toBe(true);
    expect(inPaymentUnlinkedHold({ paymentUnlinkedAt: outside, paymentUnlinkedFirstAt: null }, NOW)).toBe(false);
    // Pancake báo lại gần đây nhưng lần đầu đã quá giờ chờ: hết giữ, như cron tự huỷ.
    expect(inPaymentUnlinkedHold({ paymentUnlinkedAt: inside, paymentUnlinkedFirstAt: outside }, NOW)).toBe(false);
  });
});

describe('codSwitchRefusalMessage', () => {
  it('OVER_MAX ghi trần thật của người gọi', () => {
    expect(codSwitchRefusalMessage('OVER_MAX', 500_000)).toContain('500.000đ');
    expect(codSwitchRefusalMessage('OVER_MAX', COD_MAX_PER_ORDER * 2)).toContain(`${COD_MAX_PER_ORDER.toLocaleString('vi-VN')}đ`);
  });

  it.each(['ALREADY_PAID', 'CLOSED', 'ALREADY_COD', 'NOT_TRANSFER', 'NOT_PENDING', 'NOT_ELIGIBLE', 'PAYMENT_IN_PROGRESS'] as const)(
    '%s có câu tiếng Việt',
    (reason) => {
      expect(codSwitchRefusalMessage(reason, COD_MAX_PER_ORDER)).toMatch(/[ạảãáàăâđêôơư]/);
    },
  );
});

describe('codSwitchEligible', () => {
  it('đơn không đổi được thì không đếm lệnh thanh toán', async () => {
    const count = jest.fn();
    await expect(codSwitchEligible({ paymentAttempt: { count } } as never, { ...base, id: 'o1', status: 'CANCELLED' }, COD_MAX_PER_ORDER, NOW)).resolves.toBe(false);
    expect(count).not.toHaveBeenCalled();
  });

  it('đổi được khi chưa có lệnh thanh toán nào', async () => {
    const count = jest.fn().mockResolvedValue(0);
    await expect(codSwitchEligible({ paymentAttempt: { count } } as never, { ...base, id: 'o1' }, COD_MAX_PER_ORDER, NOW)).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith({ where: { orderId: 'o1' } });
    count.mockResolvedValue(1);
    await expect(codSwitchEligible({ paymentAttempt: { count } } as never, { ...base, id: 'o1' }, COD_MAX_PER_ORDER, NOW)).resolves.toBe(false);
  });
});

describe('switchedFromTransfer', () => {
  it('chỉ đơn COD có dòng lịch sử của lần đổi', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'h1' });
    await expect(switchedFromTransfer({ orderStatusHistory: { findFirst } } as never, { id: 'o1', paymentMethod: 'BANK_TRANSFER' })).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
    await expect(switchedFromTransfer({ orderStatusHistory: { findFirst } } as never, { id: 'o1', paymentMethod: 'COD' })).resolves.toBe(true);
    findFirst.mockResolvedValue(null);
    await expect(switchedFromTransfer({ orderStatusHistory: { findFirst } } as never, { id: 'o1', paymentMethod: 'COD' })).resolves.toBe(false);
  });
});
