import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { RefillService } from '../../src/modules/refill/refill.service';
import { RefillLocationsService } from '../../src/modules/refill/refill-locations.service';
import { createUser, randCode, warmPool } from './helpers';

/**
 * R2-ENGAGE-12 / ENGAGE-13: POST /refill/return phải theo Idempotency-Key. Bấm đúp hoặc retry sau timeout cùng key chỉ
 * tạo MỘT yêu cầu chờ duyệt (không để admin duyệt hai lần và cộng 💧 hai lần), cả hai lời gọi nhận cùng kết quả.
 */
describe('Đổi vỏ chai theo Idempotency-Key (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let refill: RefillService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, RefillLocationsService, RefillService, { provide: NotificationsService, useValue: { notify: jest.fn() } }],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    refill = moduleRef.get(RefillService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const rows = (userId: string) => prisma.bottleReturn.findMany({ where: { userId } });

  it('hai request song song cùng key → một dòng PENDING, cả hai trả cùng id', async () => {
    const user = await createUser(prisma);
    const key = `it-${randCode(8)}`;

    const results = await Promise.all([refill.returnBottles(user.id, 3, key), refill.returnBottles(user.id, 3, key)]);

    expect(results[0].id).toBe(results[1].id);
    expect(results[0]).toMatchObject({ quantity: 3, status: 'PENDING' });
    expect(await rows(user.id)).toHaveLength(1);
  });

  it('gọi lại tuần tự cùng key → trả lại yêu cầu cũ, trần tháng chỉ bị trừ một lần', async () => {
    const user = await createUser(prisma);
    const key = `it-${randCode(8)}`;

    const first = await refill.returnBottles(user.id, 4, key);
    const again = await refill.returnBottles(user.id, 4, key);

    expect(again.id).toBe(first.id);
    expect(again.monthlyRemaining).toBe(first.monthlyRemaining);
    expect(await rows(user.id)).toHaveLength(1);
  });

  it('cùng key nhưng số vỏ khác → 409, không tạo thêm và không âm thầm trả số cũ', async () => {
    const user = await createUser(prisma);
    const key = `it-${randCode(8)}`;
    await refill.returnBottles(user.id, 2, key);

    await expect(refill.returnBottles(user.id, 5, key)).rejects.toBeInstanceOf(ConflictException);
    expect(await rows(user.id)).toHaveLength(1);
  });

  it('key khác nhau là hai lần đổi riêng biệt; không key thì vẫn đổi bình thường', async () => {
    const user = await createUser(prisma);

    await refill.returnBottles(user.id, 1, `it-${randCode(8)}`);
    await refill.returnBottles(user.id, 1, `it-${randCode(8)}`);
    await refill.returnBottles(user.id, 1);
    await refill.returnBottles(user.id, 1);

    expect(await rows(user.id)).toHaveLength(4);
  });

  it('key của người này không đụng người khác', async () => {
    const [a, b] = await Promise.all([createUser(prisma), createUser(prisma)]);
    const key = `it-${randCode(8)}`;

    const ra = await refill.returnBottles(a.id, 2, key);
    const rb = await refill.returnBottles(b.id, 2, key);

    expect(ra.id).not.toBe(rb.id);
  });

  it('key rỗng/toàn khoảng trắng coi như không có key (không đụng unique)', async () => {
    const user = await createUser(prisma);

    await refill.returnBottles(user.id, 1, '   ');
    await refill.returnBottles(user.id, 1, '');

    expect(await rows(user.id)).toHaveLength(2);
  });
});
