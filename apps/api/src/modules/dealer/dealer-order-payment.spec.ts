import 'reflect-metadata';
import { BadRequestException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DealerService } from './dealer.service';
import { ConfirmDealerPaymentDto, DealerOrderAdminController } from './dealer-admin.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Đơn đại lý TRẢ TRƯỚC (chuyển khoản, không ghi công nợ) chỉ được tính "doanh số đã chốt" khi
 * paymentStatus=PAID — mà trước đây chỉ webhook đối soát Pancake lật được PAID, không có đường nào
 * cho admin xác nhận "đã nhận chuyển khoản" (Pancake chưa bật / đối soát trượt → đơn kẹt UNPAID mãi,
 * không bao giờ vào thưởng quý / mốc thưởng). Endpoint admin có audit, guard atomic.
 */

function makeConfig(): SystemConfigService {
  return { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
}

type O = { id: string; code: string; userId: string; type: string; status: string; paymentStatus: string; paymentMethod: string; total: number };
const DEALER_ORDER: O = {
  id: 'o1',
  code: 'DLR1',
  userId: 'd1',
  type: 'DEALER',
  status: 'PENDING_PAYMENT',
  paymentStatus: 'UNPAID',
  paymentMethod: 'BANK_TRANSFER',
  total: 60_000_000,
};

function build(order: O | null, opts: { creditRow?: boolean; flipCount?: number } = {}) {
  const updateMany = jest.fn().mockResolvedValue({ count: opts.flipCount ?? 1 });
  const historyCreate = jest.fn().mockResolvedValue({});
  const prisma: Record<string, unknown> = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      updateMany,
      findUniqueOrThrow: jest.fn(async () => ({ ...order, paymentStatus: 'PAID' })),
    },
    dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(opts.creditRow ? { id: 'led1' } : null) },
    orderStatusHistory: { create: historyCreate },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  // record() mock — Task 5 review finding: không test nào từng truyền analytics nên
  // if(this.analytics) luôn no-op; giờ wiring thật để có assert flip⇒event có xảy ra.
  const analytics = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new DealerService(prisma as unknown as PrismaService, makeConfig(), notifications as never, undefined, analytics as never);
  return { svc, prisma, updateMany, historyCreate, notifications, analytics };
}

describe('DealerService.confirmDealerOrderPayment (admin xác nhận đã nhận chuyển khoản)', () => {
  it('đơn trả trước PENDING_PAYMENT → PAID + CONFIRMED (như webhook Pancake), guard atomic, ghi vết ai/lúc nào, báo đại lý, ghi order_paid ATOMIC (đúng tx)', async () => {
    const { svc, updateMany, historyCreate, notifications, analytics } = build(DEALER_ORDER);
    const res = await svc.confirmDealerOrderPayment('admin1', 'DLR1', { bankRef: ' FT26270001 ', note: 'VCB 27/09' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', type: 'DEALER', paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' },
      data: { paymentStatus: 'PAID', status: 'CONFIRMED', paidAt: expect.any(Date) },
    });
    expect(historyCreate).toHaveBeenCalledTimes(1);
    const h = historyCreate.mock.calls[0]![0].data;
    expect(h).toMatchObject({ orderId: 'o1', fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', actorType: 'ADMIN', actorId: 'admin1' });
    expect(h.note).toContain('UNPAID → PAID');
    expect(h.note).toContain('FT26270001');
    expect(h.note).toContain('VCB 27/09');
    expect(notifications.notify).toHaveBeenCalledWith('d1', 'ORDER_CONFIRMED', { order_code: 'DLR1' });
    expect(res).toMatchObject({ ok: true, alreadyPaid: false, order: { id: 'o1', code: 'DLR1', paymentStatus: 'PAID' } });
    // flip count>0 ⇒ order_paid PHẢI được ghi, đúng 1 lần, đúng field, dùng ĐÚNG object tx của
    // $transaction (ở harness này tx === prisma vì mock cố tình delegate — xem test atomic riêng
    // bên dưới để chứng minh phân biệt tx/prisma thật).
    expect(analytics.record).toHaveBeenCalledTimes(1);
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'order_paid',
        userId: 'd1',
        platform: 'web',
        props: expect.objectContaining({ orderId: 'o1', method: 'BANK_TRANSFER', amount: 60_000_000, orderSource: 'dealer' }),
      }),
    );
    // occurredAt (event) phải TRÙNG paidAt (DB) — cùng 1 new Date(), không lệch mili-giây.
    const dataArg = (updateMany as jest.Mock).mock.calls[0][0].data;
    const eventArg = (analytics.record as jest.Mock).mock.calls[0][1];
    expect(eventArg.occurredAt).toEqual(dataArg.paidAt);
  });

  it('order_paid được ghi bằng ĐÚNG object `tx` của $transaction, không phải this.prisma ở ngoài (chứng minh atomic thật)', async () => {
    // build() ở file này cho tx === prisma (mock $transaction: (cb) => cb(prisma)) — test này dựng
    // RIÊNG 1 $transaction trả về tx KHÁC hẳn con trỏ `prisma`, để chứng minh code thật sự gọi
    // record(tx, ...) trong callback $transaction, không phải record(this.prisma, ...) ngoài nó.
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txHistoryCreate = jest.fn().mockResolvedValue({});
    const txMarker = { order: { updateMany: txUpdateMany }, orderStatusHistory: { create: txHistoryCreate } };
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(DEALER_ORDER) },
      dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(txMarker)),
    } as unknown as PrismaService;
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const analytics = { record: jest.fn().mockResolvedValue(undefined) };
    const svc = new DealerService(prisma, makeConfig(), notifications as never, undefined, analytics as never);
    await svc.confirmDealerOrderPayment('admin1', 'DLR1', {});
    expect(analytics.record).toHaveBeenCalledTimes(1);
    expect(analytics.record.mock.calls[0][0]).toBe(txMarker);
    expect(analytics.record.mock.calls[0][0]).not.toBe(prisma);
  });

  it('đơn đã PACKED/SHIPPING/DELIVERED mà còn UNPAID → chỉ lật PAID, giữ nguyên trạng thái giao hàng', async () => {
    const { svc, updateMany, historyCreate, analytics } = build({ ...DEALER_ORDER, status: 'SHIPPING' });
    await svc.confirmDealerOrderPayment('admin1', 'o1', {});
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', type: 'DEALER', paymentStatus: 'UNPAID', status: 'SHIPPING' },
      data: { paymentStatus: 'PAID', paidAt: expect.any(Date) },
    });
    expect(historyCreate.mock.calls[0]![0].data).toMatchObject({ fromStatus: 'SHIPPING', toStatus: 'SHIPPING', actorId: 'admin1' });
    expect(analytics.record).toHaveBeenCalledTimes(1);
  });

  it('không tìm thấy đơn → NotFound', async () => {
    const { svc, updateMany, analytics } = build(null);
    await expect(svc.confirmDealerOrderPayment('admin1', 'nope', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMany).not.toHaveBeenCalled();
    expect(analytics.record).not.toHaveBeenCalled();
  });

  it('không phải đơn đại lý → BadRequest (endpoint này CHỈ cho đơn DEALER)', async () => {
    const { svc, updateMany } = build({ ...DEALER_ORDER, type: 'RETAIL' });
    await expect(svc.confirmDealerOrderPayment('admin1', 'o1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('đơn "Ghi công nợ" → BadRequest (thanh toán công nợ đi qua sổ công nợ, đơn CREDIT không bao giờ lật PAID)', async () => {
    const { svc, updateMany } = build({ ...DEALER_ORDER, status: 'CONFIRMED' }, { creditRow: true });
    await expect(svc.confirmDealerOrderPayment('admin1', 'o1', {})).rejects.toThrow(/công nợ/);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('đơn đã PAID (webhook đã lật / bấm đúp) → trả alreadyPaid, KHÔNG ghi gì thêm', async () => {
    const { svc, updateMany, historyCreate, notifications, analytics } = build({ ...DEALER_ORDER, status: 'CONFIRMED', paymentStatus: 'PAID' });
    const res = await svc.confirmDealerOrderPayment('admin1', 'o1', {});
    expect(res).toMatchObject({ ok: true, alreadyPaid: true });
    expect(updateMany).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(analytics.record).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'RETURNED'])('đơn %s → BadRequest (cần hoàn tiền thủ công, không lật PAID — như P1-3 Pancake)', async (status) => {
    const { svc, updateMany } = build({ ...DEALER_ORDER, status });
    await expect(svc.confirmDealerOrderPayment('admin1', 'o1', {})).rejects.toThrow(/hoàn tiền thủ công/);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(['REFUNDED', 'FAILED'])('paymentStatus %s → BadRequest', async (paymentStatus) => {
    const { svc, updateMany } = build({ ...DEALER_ORDER, status: 'CONFIRMED', paymentStatus });
    await expect(svc.confirmDealerOrderPayment('admin1', 'o1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('race (webhook/huỷ đơn chen giữa): updateMany count=0 → BadRequest, không ghi vết, không báo, KHÔNG ghi order_paid', async () => {
    const { svc, historyCreate, notifications, analytics } = build(DEALER_ORDER, { flipCount: 0 });
    await expect(svc.confirmDealerOrderPayment('admin1', 'o1', {})).rejects.toThrow(/vừa thay đổi/);
    expect(historyCreate).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(analytics.record).not.toHaveBeenCalled();
  });
});

describe('DealerOrderAdminController (POST /api/admin/dealer-orders/:id/confirm-payment)', () => {
  it('chỉ ADMIN, đúng đường dẫn/method', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DealerOrderAdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(PATH_METADATA, DealerOrderAdminController)).toBe('admin/dealer-orders');
    const fn = (DealerOrderAdminController.prototype as unknown as Record<string, object>).confirmPayment!;
    expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(':id/confirm-payment');
  });

  it('chuyển adminId (JWT sub) + id + dto xuống service', async () => {
    const svc = { confirmDealerOrderPayment: jest.fn().mockResolvedValue({ ok: true }) };
    await new DealerOrderAdminController(svc as never).confirmPayment('admin1', 'o1', { bankRef: 'FT1', note: 'x' });
    expect(svc.confirmDealerOrderPayment).toHaveBeenCalledWith('admin1', 'o1', { bankRef: 'FT1', note: 'x' });
  });

  it('ConfirmDealerPaymentDto: bankRef/note tuỳ chọn, giới hạn độ dài', async () => {
    expect(await validate(plainToInstance(ConfirmDealerPaymentDto, {}))).toHaveLength(0);
    expect(await validate(plainToInstance(ConfirmDealerPaymentDto, { bankRef: 'FT1', note: 'ok' }))).toHaveLength(0);
    const bad = await validate(plainToInstance(ConfirmDealerPaymentDto, { bankRef: 'x'.repeat(101), note: 'y'.repeat(501) }));
    expect(bad.map((e) => e.property).sort()).toEqual(['bankRef', 'note']);
  });
});
