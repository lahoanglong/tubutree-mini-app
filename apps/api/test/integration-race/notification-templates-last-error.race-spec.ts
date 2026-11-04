import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationTemplatesAdminService } from '../../src/modules/notifications/notification-templates-admin.service';
import { createUser, randCode, warmPool } from './helpers';

/** L3-16: lỗi ZNS gần nhất mỗi mẫu (DISTINCT ON trong SQL) phải giống hệt `distinct` của Prisma lọc trong Node. */
describe('NotificationTemplatesAdminService.list lỗi ZNS gần nhất (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('mỗi mẫu một dòng lỗi mới nhất trong 30 ngày, bỏ lỗi cũ hơn, bỏ INAPP và trạng thái khác FAILED; cùng kết quả với cách cũ', async () => {
    const tag = randCode(6);
    const u = await createUser(prisma);
    const now = new Date();
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const codes = [`LE_A_${tag}`, `LE_B_${tag}`, `LE_C_${tag}`];
    for (const code of codes) await prisma.notificationTemplate.create({ data: { id: `it-${code}`, code, channel: 'ZNS', bodyTemplate: 'x' } });
    const log = (templateCode: string, h: number, error: string, extra: { channel?: string; status?: string } = {}) =>
      prisma.notificationLog.create({
        data: { userId: u.id, templateCode, channel: extra.channel ?? 'ZNS', status: extra.status ?? 'FAILED', payload: {}, error, sentAt: ago(h) },
      });
    await log(codes[0]!, 5, 'A cũ');
    await log(codes[0]!, 1, 'A mới nhất');
    await log(codes[0]!, 0.5, 'A đã gửi lại', { status: 'SENT' });
    await log(codes[1]!, 2, 'B mới nhất');
    await log(codes[1]!, 24 * 40, 'B quá 30 ngày');
    await log(codes[2]!, 3, 'C là INAPP', { channel: 'INAPP' });

    const since = new Date(now.getTime() - 30 * 86_400_000);
    const legacy = await prisma.notificationLog.findMany({
      where: { channel: 'ZNS', status: 'FAILED', sentAt: { gte: since }, templateCode: { in: codes } },
      orderBy: { sentAt: 'desc' },
      distinct: ['templateCode'],
      select: { templateCode: true, error: true, sentAt: true },
    });
    const rows = await new NotificationTemplatesAdminService(prisma).list(now);
    const actual = rows.filter((r) => codes.includes(r.code));
    const expected = new Map(legacy.map((l) => [l.templateCode, { text: l.error ?? 'Không rõ lý do', at: l.sentAt }]));
    for (const r of actual) expect(r.znsLastError).toEqual(expected.get(r.code) ?? null);
    expect(actual.find((r) => r.code === codes[0])!.znsLastError).toMatchObject({ text: 'A mới nhất' });
    expect(actual.find((r) => r.code === codes[1])!.znsLastError).toMatchObject({ text: 'B mới nhất' });
    expect(actual.find((r) => r.code === codes[2])!.znsLastError).toBeNull();
  });
});
