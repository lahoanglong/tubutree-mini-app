import type { PaymentMethod, PaymentStatus } from '@prisma/client';
import {
  commissionHoldDays,
  countGuestCommissionsAwaitingPayment,
  GUEST_ORDER_AWAITING_PAYMENT_WHERE,
  guestOrderAwaitingPayment,
  SETTLEABLE_ORDER_WHERE,
} from './guest-commission-settlement';

const guest = (paymentMethod: PaymentMethod, paymentStatus: PaymentStatus) => ({ guestPhone: '0912345678', paymentMethod, paymentStatus });

describe('Cổng chốt hoa hồng đơn khách vãng lai (PO A3)', () => {
  it.each<[PaymentMethod, PaymentStatus, boolean]>([
    ['COD', 'UNPAID', false],
    ['COD', 'PAID', false],
    ['BANK_TRANSFER', 'PAID', false],
    ['ZALOPAY', 'PAID', false],
    ['BANK_TRANSFER', 'UNPAID', true],
    ['ZALOPAY', 'UNPAID', true],
    ['BANK_TRANSFER', 'REFUNDED', true],
    ['COD', 'REFUNDED', true],
    ['COD', 'FAILED', true],
  ])('đơn khách %s / %s → chờ thu tiền = %s', (method, status, awaiting) => {
    expect(guestOrderAwaitingPayment(guest(method, status))).toBe(awaiting);
  });

  it('đơn đăng nhập (guestPhone null) không bao giờ bị giữ vì thanh toán', () => {
    for (const status of ['UNPAID', 'REFUNDED', 'FAILED'] as const) {
      expect(guestOrderAwaitingPayment({ guestPhone: null, paymentMethod: 'BANK_TRANSFER', paymentStatus: status })).toBe(false);
    }
  });

  it('điều kiện chốt: đơn còn DELIVERED, và là đơn đăng nhập hoặc đơn khách đã thu tiền (cùng luật với guestOrderAwaitingPayment)', () => {
    expect(SETTLEABLE_ORDER_WHERE).toEqual({
      status: 'DELIVERED',
      OR: [{ guestPhone: null }, { paymentStatus: 'PAID' }, { paymentMethod: 'COD', paymentStatus: 'UNPAID' }],
    });
  });

  it('đơn khách chờ thu tiền (where): có guestPhone và KHÔNG thuộc nhánh đã thu tiền của điều kiện chốt', () => {
    expect(GUEST_ORDER_AWAITING_PAYMENT_WHERE).toEqual({
      guestPhone: { not: null },
      NOT: { OR: [{ paymentStatus: 'PAID' }, { paymentMethod: 'COD', paymentStatus: 'UNPAID' }] },
    });
  });

  it('đếm khoản quá hạn giữ chờ thu tiền: LOCKED, khoá trước mốc, đơn còn DELIVERED và là đơn khách chưa thu tiền', async () => {
    const count = jest.fn().mockResolvedValue(4);
    const before = new Date('2026-11-10T00:00:00Z');
    await expect(countGuestCommissionsAwaitingPayment({ commission: { count } } as never, before)).resolves.toBe(4);
    expect(count).toHaveBeenCalledWith({
      where: { status: 'LOCKED', lockedAt: { lte: before }, order: { status: 'DELIVERED', ...GUEST_ORDER_AWAITING_PAYMENT_WHERE } },
    });
  });

  it.each<[Record<string, unknown>, number]>([
    [{}, 10],
    [{ 'affiliate.hold_days': 3, 'returns.window_days': 7 }, 7],
    [{ 'affiliate.hold_days': 21, 'returns.window_days': 7 }, 21],
    [{ 'affiliate.hold_days': 'x', 'returns.window_days': 5 }, 5],
  ])('số ngày giữ thực = max(hold, cửa sổ đổi/trả): %j → %d', async (cfg, days) => {
    const get = jest.fn(async (key: string, fallback?: unknown) => (key in cfg ? cfg[key] : fallback));
    await expect(commissionHoldDays({ get } as never)).resolves.toBe(days);
  });

  it('không có SystemConfigService: dùng mặc định 10 / 7 ngày', async () => {
    await expect(commissionHoldDays()).resolves.toBe(10);
  });
});
