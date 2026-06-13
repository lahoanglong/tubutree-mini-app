import { PancakeProcessor } from './pancake.processor';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { LoyaltyService } from '../../loyalty/loyalty.service';
import type { AffiliateService } from '../../affiliate/affiliate.service';

function setup(order: unknown) {
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockResolvedValue({}),
    },
    pancakeWebhookEvent: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    variation: { updateMany: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
  const loyalty = {
    creditOrderPoints: jest.fn().mockResolvedValue(undefined),
    reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
  } as unknown as LoyaltyService;
  const affiliate = {
    lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
  } as unknown as AffiliateService;
  const proc = new PancakeProcessor(prisma, notifications, loyalty, affiliate) as unknown as {
    onStatusUpdated(d: Record<string, unknown>): Promise<void>;
    onCancelled(d: Record<string, unknown>): Promise<void>;
    extractOrderCode(d: Record<string, unknown>): string | null;
    process(job: { data: { eventId: string } }): Promise<void>;
  };
  return { proc, prisma, notifications, loyalty, affiliate };
}

describe('PancakeProcessor.extractOrderCode', () => {
  const { proc } = setup(null);
  it('ưu tiên extension.external_order_id', () => {
    expect(proc.extractOrderCode({ extension: { external_order_id: 'TUBU9' }, note: 'TUBU1' })).toBe('TUBU9');
  });
  it('fallback regex TUBU... trong note', () => {
    expect(proc.extractOrderCode({ note: 'Khách dặn giao chiều - Order code: TUBU20260613001' })).toBe(
      'TUBU20260613001',
    );
  });
  it('không có gì → null', () => {
    expect(proc.extractOrderCode({})).toBeNull();
  });
});

describe('PancakeProcessor.onStatusUpdated', () => {
  it('DELIVERED → update + credit điểm + lock hoa hồng + notify', async () => {
    const { proc, prisma, loyalty, affiliate, notifications } = setup({
      id: 'o1',
      code: 'TUBU1',
      userId: 'u1',
      status: 'SHIPPING',
    });
    await proc.onStatusUpdated({ id: 'p1', status: 'delivered' });
    expect((prisma.order.update as jest.Mock).mock.calls[0][0].data.status).toBe('DELIVERED');
    expect(loyalty.creditOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.lockCommissionsForOrder).toHaveBeenCalledWith('o1');
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_DELIVERED', { order_code: 'TUBU1' });
  });

  it('trạng thái không đổi → no-op (idempotent, không credit lại)', async () => {
    const { proc, prisma, loyalty } = setup({ id: 'o1', code: 'TUBU1', userId: 'u1', status: 'DELIVERED' });
    await proc.onStatusUpdated({ id: 'p1', status: 'delivered' });
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
  });

  it('status không map được → no-op', async () => {
    const { proc, prisma } = setup({ id: 'o1', code: 'TUBU1', userId: 'u1', status: 'SHIPPING' });
    await proc.onStatusUpdated({ id: 'p1', status: 'gibberish' });
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('CANCELLED → reverse điểm + reverse hoa hồng', async () => {
    const { proc, loyalty, affiliate } = setup({ id: 'o1', code: 'TUBU1', userId: 'u1', status: 'CONFIRMED' });
    await proc.onStatusUpdated({ id: 'p1', status: 'cancelled' });
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
  });

  it('đơn không tìm thấy → no-op', async () => {
    const { proc, prisma } = setup(null);
    await proc.onStatusUpdated({ id: 'p1', status: 'delivered' });
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

describe('PancakeProcessor.onCancelled', () => {
  it('đơn đã CANCELLED → không xử lý lại', async () => {
    const { proc, prisma, loyalty } = setup({ id: 'o1', code: 'TUBU1', userId: 'u1', status: 'CANCELLED' });
    await proc.onCancelled({ id: 'p1' });
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
  });
});

describe('PancakeProcessor.process', () => {
  it('event đã PROCESSED → bỏ qua', async () => {
    const { proc, prisma, notifications } = setup(null);
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({ id: 'e1', status: 'PROCESSED' });
    await proc.process({ data: { eventId: 'e1' } });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.pancakeWebhookEvent.update).not.toHaveBeenCalled();
  });

  it('xử lý thành công → đánh dấu PROCESSED', async () => {
    const { proc, prisma } = setup({ id: 'o1', code: 'TUBU1', userId: 'u1', status: 'SHIPPING' });
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'e1',
      status: 'RECEIVED',
      rawPayload: { event: 'order.status_updated', data: { id: 'p1', status: 'delivered' } },
    });
    await proc.process({ data: { eventId: 'e1' } });
    expect((prisma.pancakeWebhookEvent.update as jest.Mock).mock.calls[0][0].data.status).toBe('PROCESSED');
  });

  it('handler ném lỗi → đánh dấu FAILED + rethrow (BullMQ retry)', async () => {
    const { proc, prisma, loyalty } = setup({ id: 'o1', code: 'TUBU1', userId: 'u1', status: 'SHIPPING' });
    (prisma.pancakeWebhookEvent.findUnique as jest.Mock).mockResolvedValue({
      id: 'e1',
      status: 'RECEIVED',
      rawPayload: { event: 'order.status_updated', data: { id: 'p1', status: 'delivered' } },
    });
    (loyalty.creditOrderPoints as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(proc.process({ data: { eventId: 'e1' } })).rejects.toThrow('boom');
    expect((prisma.pancakeWebhookEvent.update as jest.Mock).mock.calls[0][0].data.status).toBe('FAILED');
  });
});
