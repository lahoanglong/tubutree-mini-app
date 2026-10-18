import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteAdminPointsService } from '../../src/modules/waste-exchange/catalog/waste-admin-points.service';
import { createUser, deleteItData, randCode, warmPool } from './helpers';
import { cleanupWaste, raceWithHold } from './fixtures/waste-fixtures';

function noDeadlock(results: PromiseSettledResult<unknown>[]) {
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
  expect(errors.join()).not.toMatch(/40P01|deadlock|P2034/);
}

const FULL = 'Đã đủ 200 điểm nhận, không tạo thêm được.';
const addr = { addressLine: 'IT', provinceCode: '79', provinceName: 'TP.HCM', communeCode: 'IT', communeName: 'IT' };

/**
 * WasteAdminPointsService.create trên Postgres thật: hai lần tạo cùng lúc khi chỉ còn một chỗ (199 điểm), khoá tư vấn
 * pg_advisory_xact_lock(731004, 0) của lockWastePointCreate chia chỗ cuối cho đúng một bên.
 */
describe('waste-admin-points race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let points: WasteAdminPointsService;
  const userIds: string[] = [];
  let fillIds: string[] = [];
  let createdIds: string[] = [];
  let tooFull = false;
  // Both creates queue on this class inside their transaction (registry 4.3).
  const L = Prisma.sql`SELECT pg_advisory_xact_lock(731004, 0)`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        WasteConfigService,
        WasteAccessService,
        WasteAdminPointsService,
        { provide: WasteNotifierService, useValue: { perkReviewed: jest.fn() } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    points = moduleRef.get(WasteAdminPointsService);
  });

  beforeEach(async () => {
    const n = await prisma.wastePoint.count();
    tooFull = n > 199;
    if (tooFull) return;
    fillIds = Array.from({ length: 199 - n }, (_, i) => `it-fill-${randCode(8)}-${i}`);
    await prisma.wastePoint.createMany({
      data: fillIds.map((id) => ({
        id, kind: 'PARTNER' as const, name: 'IT fill', ...addr, status: 'PAUSED' as const, monthlyQuotaPoints: 100_000,
      })),
    });
  });

  afterEach(async () => {
    await cleanupWaste(prisma, { pointIds: [...fillIds, ...createdIds] });
    fillIds = [];
    createdIds = [];
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  const bodyOf = (name: string) => ({ kind: 'PARTNER' as const, name, ...addr, monthlyQuotaPoints: 100_000 });

  async function lastSlot(aFirst: boolean) {
    if (tooFull) {
      process.stderr.write(`waste-admin-points race skipped: ${await prisma.wastePoint.count()} points already exist (more than 199)\n`);
      return;
    }
    const admin = await createUser(prisma, { role: 'ADMIN' });
    userIds.push(admin.id);
    const createA = () => points.create(admin.id, bodyOf(`IT A ${randCode(6)}`));
    const createB = () => points.create(admin.id, bodyOf(`IT B ${randCode(6)}`));

    const results = aFirst ? await raceWithHold(prisma, L, createA, createB) : await raceWithHold(prisma, L, createB, createA);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    const rejected = results[1] as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect((rejected.reason as ConflictException).message).toBe(FULL);
    createdIds.push((results[0] as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(await prisma.wastePoint.count()).toBe(200);
    noDeadlock(results);
  }

  it('create A then create B at 199 points: A takes the last slot, B gets the 200-point 409', () => lastSlot(true));

  it('create B then create A at 199 points: B takes the last slot, A gets the 200-point 409', () => lastSlot(false));
});
