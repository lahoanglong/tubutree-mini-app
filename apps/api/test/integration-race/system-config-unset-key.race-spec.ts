import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { SystemConfigController } from '../../src/modules/system-config/system-config.controller';
import { warmPool } from './helpers';

/**
 * C-054: khoá seed với giá trị JSON null ("chưa đặt", vd ETA giao hàng) phải đặt được số đầu tiên từ admin và
 * ghi lịch sử với oldValue là JSON null — trên Postgres THẬT (cột Json bắt buộc, Prisma đòi Prisma.JsonNull).
 */
describe('SystemConfig: khoá JSON null → đặt giá trị đầu tiên (real Postgres)', () => {
  let prisma: PrismaService;
  const MIN = 'shipping.eta_min_days';
  const MAX = 'shipping.eta_max_days';

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  beforeEach(async () => {
    await prisma.systemConfigHistory.deleteMany({ where: { key: { in: [MIN, MAX] } } });
    for (const key of [MIN, MAX]) {
      await prisma.systemConfig.upsert({
        where: { key },
        create: { key, value: Prisma.JsonNull, category: 'shipping' },
        update: { value: Prisma.JsonNull },
      });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('đang null → set số thành công, history oldValue là JSON null; đọc lại ra số', async () => {
    const svc = new SystemConfigService(prisma);
    await svc.set(MIN, 2, 'admin-it');

    const row = await prisma.systemConfig.findUniqueOrThrow({ where: { key: MIN } });
    expect(row.value).toBe(2);
    const hist = await prisma.$queryRaw<{ old_value: string; new_value: string }[]>`
      SELECT "oldValue"::text AS old_value, "newValue"::text AS new_value FROM system_config_history WHERE key = ${MIN}`;
    expect(hist).toEqual([{ old_value: 'null', new_value: '2' }]);
  });

  it('còn null cả hai khoá → config công khai ẩn ETA; admin đặt 2 và 4 → hiện { minDays: 2, maxDays: 4 }', async () => {
    const svc = new SystemConfigService(prisma);
    const ctrl = new SystemConfigController(svc);
    expect((await ctrl.publicConfig()).shippingEta).toBeNull();

    await svc.set(MIN, 2, 'admin-it');
    await svc.set(MAX, 4, 'admin-it');
    expect((await ctrl.publicConfig()).shippingEta).toEqual({ minDays: 2, maxDays: 4 });
  });

  it('đã có số → vẫn chặn ghi chuỗi', async () => {
    const svc = new SystemConfigService(prisma);
    await svc.set(MIN, 2, 'admin-it');
    await expect(svc.set(MIN, 'hai' as unknown as number, 'admin-it')).rejects.toBeInstanceOf(BadRequestException);
  });
});
