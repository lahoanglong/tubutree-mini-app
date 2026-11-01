import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { deleteItData, warmPool } from './helpers';

const ADMINS = 5;
const ROUNDS = 6;

/**
 * Nút "Tạo khung giờ" ở tab Giờ vàng (Postgres thật): nhiều admin bấm cùng một lúc không được tạo trùng đợt. Mỗi bên tự đọc "mốc nào đã có
 * đợt" trước khi ghi nên nếu không có khoá riêng thì cả hai cùng thấy chưa có và cùng tạo. Ngày chạy là một ngày xa trong tương lai, chọn ngẫu
 * nhiên mỗi vòng để không đụng đợt thật hay đợt còn sót của lần chạy trước.
 */
describe('generateSlots: nhiều admin bấm cùng lúc không tạo trùng khung (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let flash: FlashSaleService;
  const created = { flashSaleIds: [] as string[] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        FlashSaleService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: LifecycleService, useValue: { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    flash = moduleRef.get(FlashSaleService);
  });

  afterAll(async () => {
    if (prisma) await deleteItData(prisma, created);
    await moduleRef?.close();
  });

  it(`${ADMINS} admin bấm đồng thời (${ROUNDS} vòng): mỗi mốc đúng một đợt, tổng created = số mốc, phần còn lại là skipped`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      // 05:00 giờ VN của một ngày xa: hai khung mặc định 12:00 và 20:00 hôm đó và hôm sau còn phía trước => 4 mốc.
      const now = new Date(Date.UTC(2100 + randomInt(0, 800), randomInt(0, 12), 1 + randomInt(0, 27), 22, 0, 0) - 24 * 3_600_000);
      const results = await Promise.all(Array.from({ length: ADMINS }, (_, i) => flash.generateSlots(`it-admin-${i}`, 2, now)));
      const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0);
      const rows = await prisma.flashSale.findMany({ where: { startAt: { gte: new Date(dayStart - 3_600_000), lt: new Date(dayStart + 3 * 24 * 3_600_000) } } });
      created.flashSaleIds.push(...rows.map((r) => r.id));

      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((r) => r.startAt.getTime())).size).toBe(4);
      expect(results.reduce((n, r) => n + r.created, 0)).toBe(4);
      expect(results.reduce((n, r) => n + r.skipped, 0)).toBe(4 * (ADMINS - 1));
      expect(rows.every((r) => r.endAt.getTime() - r.startAt.getTime() === 2 * 3_600_000)).toBe(true);
    }
  });
});
