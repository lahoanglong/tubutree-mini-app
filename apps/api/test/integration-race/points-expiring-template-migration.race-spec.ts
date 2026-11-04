import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { readApiSql } from './sql-script';

/**
 * TK-04 bổ sung trên Postgres thật: chạy lại CHÍNH file migration với từng bản lời tin PROD có thể đang giữ.
 * 20261104070000 không đổi được câu trên PROD vì PROD còn bản "điểm Xanh" viết thường, do prisma:seed của bản thử cb92dc8 chèn.
 */
describe('migration 20261104100000 đổi mẫu POINTS_EXPIRING (real Postgres)', () => {
  const SQL = readApiSql('prisma/migrations/20261104100000_points_expiring_template_lowercase_variant/migration.sql');
  const NEW_BODY = 'Bạn có {{points}} Điểm Xanh hết hạn trong {{days}} ngày tới, sớm nhất vào {{date}}.';
  // Nguyên văn cb92dc8:apps/api/prisma/seed.ts dòng 705, bản PROD đang giữ. Không sửa chữ.
  const OLD_LOWER = '⏳ Bạn có {{points}} điểm Xanh sắp hết hạn vào {{date}}. Dùng để đổi ưu đãi trước khi lỡ nhé! 🌿';
  const OLD_UPPER = '⏳ Bạn có {{points}} Điểm Xanh sắp hết hạn vào {{date}}. Dùng để đổi ưu đãi trước khi lỡ nhé! 🌿';
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let original: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    original = (await prisma.notificationTemplate.findFirstOrThrow({ where: { code: 'POINTS_EXPIRING' } })).bodyTemplate;
  });

  afterAll(async () => {
    await prisma?.notificationTemplate.updateMany({ where: { code: 'POINTS_EXPIRING' }, data: { bodyTemplate: original } });
    await moduleRef?.close();
  });

  async function migrateFrom(body: string): Promise<{ changed: number; after: string }> {
    await prisma.notificationTemplate.updateMany({ where: { code: 'POINTS_EXPIRING' }, data: { bodyTemplate: body } });
    const changed = await prisma.$executeRawUnsafe(SQL);
    const after = (await prisma.notificationTemplate.findFirstOrThrow({ where: { code: 'POINTS_EXPIRING' } })).bodyTemplate;
    return { changed, after };
  }

  it.each([
    ['bản "điểm Xanh" viết thường đang có trên PROD', OLD_LOWER],
    ['bản "Điểm Xanh" viết hoa', OLD_UPPER],
  ])('%s -> đổi sang câu mới', async (_label, body) => {
    expect(await migrateFrom(body)).toEqual({ changed: 1, after: NEW_BODY });
  });

  it('lý do có migration này: 20261104070000 không đổi được bản viết thường', async () => {
    await prisma.notificationTemplate.updateMany({ where: { code: 'POINTS_EXPIRING' }, data: { bodyTemplate: OLD_LOWER } });
    expect(await prisma.$executeRawUnsafe(readApiSql('prisma/migrations/20261104070000_points_expiring_template_days/migration.sql'))).toBe(0);
  });

  it('bản admin đã sửa tay -> giữ nguyên', async () => {
    const custom = '⏳ Bạn có {{points}} điểm Xanh sắp hết hạn vào {{date}}, đổi quà ngay nhé!';
    expect(await migrateFrom(custom)).toEqual({ changed: 0, after: custom });
  });

  it('đã là câu mới -> chạy lại không đổi gì', async () => {
    expect(await migrateFrom(NEW_BODY)).toEqual({ changed: 0, after: NEW_BODY });
  });
});
