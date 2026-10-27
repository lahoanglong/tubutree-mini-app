import { OrderStatusService } from './order-status.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OrderReversalService } from './order-reversal.service';
import type { GameOrderWaterService } from '../game/game-order-water.service';

function make(grant?: jest.Mock) {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue({ id: 'o1', code: 'TUBU1', status: 'DELIVERED', deliveredEffectsAt: null }),
      updateMany,
    },
  };
  const loyalty = { creditOrderPoints: jest.fn().mockResolvedValue(true) };
  const affiliate = { lockCommissionsForOrder: jest.fn().mockResolvedValue(2), grantReferralReward: jest.fn().mockResolvedValue(undefined) };
  const svc = new OrderStatusService(
    prisma as unknown as PrismaService,
    loyalty as unknown as LoyaltyService,
    affiliate as unknown as AffiliateService,
    {} as unknown as NotificationsService,
    {} as unknown as OrderReversalService,
    undefined,
    undefined,
    undefined,
    undefined,
    grant ? ({ grantForOrder: grant } as unknown as GameOrderWaterService) : undefined,
  );
  return { svc, updateMany, loyalty, affiliate };
}

describe('OrderStatusService — nước thưởng game trong việc sau giao', () => {
  it('cộng nước cho đúng đơn rồi ghi mốc xong việc', async () => {
    const grant = jest.fn().mockResolvedValue({ granted: 100 });
    const { svc, updateMany } = make(grant);
    await expect(svc.resyncDeliveredEffects('o1')).resolves.toMatchObject({ outcome: 'DONE' });
    expect(grant).toHaveBeenCalledWith('o1');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('game lỗi: Điểm Xanh và hoa hồng vẫn đã chạy, không ném, không ghi mốc để cron thử lại', async () => {
    const grant = jest.fn().mockRejectedValue(new Error('db down'));
    const { svc, updateMany, loyalty, affiliate } = make(grant);
    await expect(svc.resyncDeliveredEffects('o1')).resolves.toMatchObject({
      outcome: 'INCOMPLETE',
      pointsCredited: true,
      commissionsLocked: 2,
      error: expect.stringContaining('db down'),
    });
    expect(loyalty.creditOrderPoints).toHaveBeenCalledTimes(1);
    expect(affiliate.lockCommissionsForOrder).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('không gắn dịch vụ game thì vẫn xong như trước', async () => {
    const { svc, updateMany } = make();
    await expect(svc.resyncDeliveredEffects('o1')).resolves.toMatchObject({ outcome: 'DONE' });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
