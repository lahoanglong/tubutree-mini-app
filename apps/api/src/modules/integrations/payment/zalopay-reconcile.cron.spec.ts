import { ZalopayReconcileCron } from './zalopay-reconcile.cron';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ZalopayService } from './zalopay.service';

/** R2-LIFECYCLE-1: callback thất lạc thì cron hỏi ZaloPay và ghi nhận qua đúng đường của callback. */
describe('ZalopayReconcileCron', () => {
  const now = new Date('2026-10-14T10:00:00Z');

  function setup(attempts: { id: string; appTransId: string }[], query: jest.Mock, configured = true) {
    const findMany = jest.fn().mockResolvedValue(attempts);
    const update = jest.fn().mockResolvedValue({});
    const prisma = { paymentAttempt: { findMany, update } } as unknown as PrismaService;
    const zalopay = {
      configured,
      queryOrderStatus: query,
      applyGatewayPayment: jest.fn().mockResolvedValue(undefined),
      resolveAttempt: jest.fn().mockResolvedValue(undefined),
    };
    const cron = new ZalopayReconcileCron(prisma, zalopay as unknown as ZalopayService);
    return { cron, findMany, update, zalopay };
  }

  it('chỉ hỏi lần thử chưa có kết quả của đơn ZaloPay chưa nhận tiền (đang chờ hoặc đã huỷ), trong cửa sổ 48 giờ', async () => {
    const { cron, findMany } = setup([], jest.fn());
    await cron.reconcile(now);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        provider: 'ZALOPAY',
        resolvedAt: null,
        createdAt: { gte: new Date('2026-10-12T10:00:00Z'), lte: new Date('2026-10-14T09:57:00Z') },
        order: { paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID', status: { in: ['PENDING_PAYMENT', 'CANCELLED'] } },
      }),
    );
  });

  it('return_code 1 → ghi nhận qua applyGatewayPayment với số tiền ZaloPay báo; 2 → đóng lần thử; 3 → hỏi lại sau', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ return_code: 1, amount: 285000 })
      .mockResolvedValueOnce({ return_code: 2, sub_return_code: -54 })
      .mockResolvedValueOnce({ return_code: 3, is_processing: true });
    const { cron, zalopay, update } = setup(
      [
        { id: 'a1', appTransId: 't1' },
        { id: 'a2', appTransId: 't2' },
        { id: 'a3', appTransId: 't3' },
      ],
      query,
    );
    const res = await cron.reconcile(now);
    expect(res).toEqual({ scanned: 3, paid: 1, failed: 1, pending: 1, errors: 0 });
    expect(zalopay.applyGatewayPayment).toHaveBeenCalledTimes(1);
    expect(zalopay.applyGatewayPayment).toHaveBeenCalledWith('t1', 285000, 'query');
    expect(zalopay.resolveAttempt).toHaveBeenCalledWith('a2');
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledWith({ where: { id: 'a3' }, data: { lastQueriedAt: now } });
  });

  it('một lần hỏi lỗi mạng không chặn các lần thử còn lại', async () => {
    const query = jest.fn().mockRejectedValueOnce(new Error('ETIMEDOUT')).mockResolvedValueOnce({ return_code: 1, amount: 100 });
    const { cron, zalopay } = setup(
      [
        { id: 'a1', appTransId: 't1' },
        { id: 'a2', appTransId: 't2' },
      ],
      query,
    );
    const res = await cron.reconcile(now);
    expect(res).toEqual({ scanned: 2, paid: 1, failed: 0, pending: 0, errors: 1 });
    expect(zalopay.applyGatewayPayment).toHaveBeenCalledWith('t2', 100, 'query');
  });

  it('chưa cấu hình ZaloPay → không hỏi gì', async () => {
    const { cron, findMany } = setup([], jest.fn(), false);
    await expect(cron.reconcile(now)).resolves.toEqual({ skipped: 'NOT_CONFIGURED' });
    expect(findMany).not.toHaveBeenCalled();
  });
});
