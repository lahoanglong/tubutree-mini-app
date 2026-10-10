import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/** Q-09: admin mở lại claim thưởng đại lý bị từ chối, trên Postgres thật. */
describe('DealerService.reopenRewardClaim (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        { provide: NotificationsService, useValue: { notify } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    dealer = moduleRef.get(DealerService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('5 admin cùng mở lại một claim REJECTED -> đúng 1 người thắng, dấu vết ghi đúng 1 lần; đại lý vẫn chỉ có 1 dòng claim; duyệt được sau đó', async () => {
    const d = await createUser(prisma, { role: 'DEALER' });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const reward = await prisma.dealerReward.create({
      data: { type: 'TOUR', title: `Tour reopen ${d.id}`, threshold: 50_000_000, period: 'QUARTER', isActive: true },
    });
    await createOrder(prisma, {
      userId: d.id,
      type: 'DEALER',
      status: 'DELIVERED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      total: 60_000_000,
      subtotal: 60_000_000,
    });
    const first = await dealer.claimReward(d.id, reward.id);
    const claimId = first.claim.id;
    await dealer.rejectRewardClaim(admin.id, claimId, 'Nhầm kỳ');
    expect((await prisma.dealerRewardClaim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe('REJECTED');

    // Gửi lại khi còn REJECTED: vẫn bị chặn bởi unique, trả claim cũ (từ chối là cuối với đại lý).
    const again = await dealer.claimReward(d.id, reward.id);
    expect(again.alreadyClaimed).toBe(true);
    expect(again.claimStatus).toBe('REJECTED');

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => dealer.reopenRewardClaim(admin.id, claimId, `lý do ${i}`)),
    );
    const s = summarize(results);
    const row = await prisma.dealerRewardClaim.findUniqueOrThrow({ where: { id: claimId } });
    console.log('[reopen] fulfilled=%d rejected=%d status=%s errors=%j', s.fulfilled.length, s.rejected.length, row.status, [...new Set(s.errors)]);

    expect(s.fulfilled).toHaveLength(1);
    expect(s.rejected).toHaveLength(4);
    s.rejected.forEach((r) => expect(r.reason).toBeInstanceOf(BadRequestException));
    expect(row.status).toBe('PENDING');
    expect(row.rejectionReason).toBeNull();
    expect(row.reviewedBy).toBeNull();
    expect((row.adminNote ?? '').match(/Mở lại/g)).toHaveLength(1);
    expect(row.adminNote).toContain('Nhầm kỳ');
    expect(await prisma.dealerRewardClaim.count({ where: { userId: d.id } })).toBe(1);

    const approved = await dealer.approveRewardClaim(admin.id, claimId);
    expect(approved.status).toBe('APPROVED');
    await expect(dealer.reopenRewardClaim(admin.id, claimId)).rejects.toBeInstanceOf(BadRequestException);
  });
});
