import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { barrierOnFirstCalls, createOrder, createUser, summarize, warmPool } from './helpers';

/** DealerService.claimReward / approveRewardClaim trên Postgres thật — chỉ stub thông báo + Pancake. */
describe('DealerService reward claim race (real Postgres)', () => {
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

  it('(e) 5 concurrent claimReward -> 1 dealer_reward_claims row; then 2 concurrent approves -> exactly 1 succeeds', async () => {
    const THRESHOLD = 50_000_000;
    const d = await createUser(prisma, { role: 'DEALER' });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const reward = await prisma.dealerReward.create({
      data: { type: 'TOUR', title: `Tour IT ${d.id}`, threshold: THRESHOLD, period: 'QUARTER', isActive: true },
    });
    // Doanh số ĐÃ CHỐT quý hiện tại: đơn DEALER đã giao + đã thanh toán, tạo bây giờ.
    await createOrder(prisma, {
      userId: d.id,
      type: 'DEALER',
      status: 'DELIVERED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      total: 60_000_000,
      subtotal: 60_000_000,
    });

    // Rào chắn: cả 5 cùng chạy pre-check findFirst (ngoài tx) → đều thấy "chưa yêu cầu" → cả 5
    // INSERT. createCalls = 5 chứng minh chính unique (userId, periodKey, rewardId) chặn 4 kẻ thua.
    const gate = barrierOnFirstCalls(prisma.dealerRewardClaim, 'findFirst', 5);
    const createSpy = jest.spyOn(prisma.dealerRewardClaim, 'create');
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => dealer.claimReward(d.id, reward.id)));
    const createCalls = createSpy.mock.calls.length;
    createSpy.mockRestore();
    gate.mockRestore();
    const s = summarize(results);
    const claims = await prisma.dealerRewardClaim.findMany({ where: { userId: d.id } });

    // eslint-disable-next-line no-console
    console.log(
      '[e1] fulfilled=%d rejected=%d insertsAttempted=%d alreadyClaimed=%j errors=%j',
      s.fulfilled.length,
      s.rejected.length,
      createCalls,
      s.fulfilled.map((f) => f.value.alreadyClaimed),
      [...new Set(s.errors)],
    );

    expect(createCalls).toBe(5); // cả 5 lọt pre-check → race thật sự chạm unique DB
    expect(claims).toHaveLength(1);
    expect(claims[0]!.status).toBe('PENDING');
    expect(s.fulfilled).toHaveLength(5);
    expect(s.fulfilled.filter((f) => !f.value.alreadyClaimed)).toHaveLength(1);
    const claimId = claims[0]!.id;
    expect(new Set(s.fulfilled.map((f) => f.value.claim.id))).toEqual(new Set([claimId]));

    // 2 admin duyệt cùng lúc → đúng 1 người thắng (updateMany có guard status PENDING).
    const approves = await Promise.allSettled([
      dealer.approveRewardClaim(admin.id, claimId, 'admin A'),
      dealer.approveRewardClaim(admin.id, claimId, 'admin B'),
    ]);
    const sa = summarize(approves);
    const final = await prisma.dealerRewardClaim.findUniqueOrThrow({ where: { id: claimId } });

    // eslint-disable-next-line no-console
    console.log('[e2] fulfilled=%d rejected=%d finalStatus=%s errors=%j', sa.fulfilled.length, sa.rejected.length, final.status, sa.errors);

    expect(sa.fulfilled).toHaveLength(1);
    expect(sa.rejected).toHaveLength(1);
    expect(sa.rejected[0]!.reason).toBeInstanceOf(BadRequestException);
    expect(final.status).toBe('APPROVED');
    expect(final.reviewedBy).toBe(admin.id);
    // Chỉ người thắng báo đại lý "đã duyệt".
    const approvedNotices = notify.mock.calls.filter((c) => c[1] === 'DEALER_REWARD_CLAIM_APPROVED');
    expect(approvedNotices).toHaveLength(1);
  });
});
