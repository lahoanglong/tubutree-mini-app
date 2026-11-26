import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MailTransportFactory } from '../../ops/smtp-transport';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { ORDER_EMAIL_FALLBACK_FLAG, OrderConfirmEmailService } from './order-confirm-email.service';

/**
 * Luật email cấp đơn (wave tubu-w41-01, PO): đơn có dòng người mua `RESULT_SENT` hoặc `RESULT_UNKNOWN` (MSS có thể đã gửi tin Zalo) thì
 * không gửi email xác nhận cho sự kiện khác của đơn, kể cả khi sự kiện đó tự nó đủ điều kiện. Prisma giả theo khuôn spec MSS khác.
 */
describe('OrderConfirmEmailService: anh em RESULT_SENT/RESULT_UNKNOWN chặn email cả đơn', () => {
  const READY_SMTP: Record<string, string> = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_FROM: 'Tubu Tree <no-reply@tubutree.com>',
    OPS_ALERT_EMAIL_TO: 'ops@tubutree.com',
    JWT_ACCESS_SECRET: 'unit-secret',
  };

  beforeEach(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  /** Dòng `order.created` người mua, MSS báo lỗi (RESULT_FAILED): tự nó đủ điều kiện email. */
  function setup(sibling: { id: string } | null) {
    const row = {
      orderId: 'ord-1',
      eventId: 'evt-paid',
      eventType: 'order.created',
      recipientRole: 'buyer',
      status: 'RESULT_FAILED',
      resultReason: 'zalo_error',
      lastHttpStatus: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      order: {
        code: 'TB1A2B',
        status: 'CONFIRMED',
        createdAt: new Date(),
        userId: 'u1',
        guestTokenHash: null,
        total: 250_000,
        paymentMethod: 'COD',
        paymentStatus: 'PENDING',
        invoiceRequest: null,
        user: { email: 'lan@example.com', zaloId: null, phone: '0912345678', mergedIntoId: null },
        items: [{ productName: 'Nước giặt', variationName: 'Can', quantity: 1, isGift: false }],
      },
    };
    const findFirst = jest.fn(async () => sibling);
    const $transaction = jest.fn(async () => ({ kind: 'DUPLICATE' as const }));
    const prisma = {
      mssOrderEventOutbox: { findUnique: jest.fn(async () => row), findFirst },
      $transaction,
    } as unknown as PrismaService;
    const config = { get: jest.fn(async (k: string, fb: unknown) => (k === ORDER_EMAIL_FALLBACK_FLAG ? true : fb)) } as unknown as SystemConfigService;
    const env = { get: (k: string) => READY_SMTP[k] } as unknown as ConfigService<Env, true>;
    const factory = jest.fn() as unknown as jest.Mock & MailTransportFactory;
    return { service: new OrderConfirmEmailService(prisma, config, env, factory), findFirst, $transaction, factory };
  }

  it('U1 có dòng anh em chặn (findFirst trả dòng): NOT_ELIGIBLE, không mở transaction, không dựng SMTP', async () => {
    const { service, $transaction, factory } = setup({ id: 'evt-created-unknown' });
    expect(await service.sendForEvent('row-paid')).toBe('NOT_ELIGIBLE');
    expect($transaction).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it('U2 câu tìm anh em lọc theo đơn, người mua và cả RESULT_SENT lẫn RESULT_UNKNOWN', async () => {
    const { service, findFirst } = setup({ id: 'evt-created-unknown' });
    await service.sendForEvent('row-paid');
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { orderId: 'ord-1', recipientRole: 'buyer', status: { in: ['RESULT_SENT', 'RESULT_UNKNOWN'] } },
      select: { id: true },
    });
  });

  it('U3 đối chứng: không có anh em chặn thì đi tiếp tới bước nhận việc (transaction)', async () => {
    const { service, $transaction, factory } = setup(null);
    expect(await service.sendForEvent('row-paid')).toBe('DUPLICATE');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(factory).not.toHaveBeenCalled();
  });
});
