import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { readApiSql } from './sql-script';

/** Chạy lại CHÍNH file migration 20261104120000 trên Postgres thật với từng bản lời mẫu INVOICE_ISSUED PROD có thể đang giữ. */
describe('migration 20261104120000 đổi chữ mẫu INVOICE_ISSUED (real Postgres)', () => {
  const SQL = readApiSql('prisma/migrations/20261104120000_invoice_issued_template_spelling/migration.sql');
  const NEW_BODY = 'Hoá đơn VAT cho đơn {{order_code}} đã được phát hành.';
  // Nguyên văn cb92dc8:apps/api/prisma/seed.ts (test/fixtures/prod-baseline-cb92dc8-notification-templates.json). Không sửa chữ.
  const OLD_BODY = 'Hóa đơn VAT cho đơn {{order_code}} đã được phát hành.';
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let original: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await prisma.notificationTemplate.upsert({
      where: { code: 'INVOICE_ISSUED' },
      create: { id: 'nt-invoice', code: 'INVOICE_ISSUED', channel: 'INAPP', bodyTemplate: NEW_BODY },
      update: {},
    });
    original = (await prisma.notificationTemplate.findUniqueOrThrow({ where: { code: 'INVOICE_ISSUED' } })).bodyTemplate;
  });

  afterAll(async () => {
    await prisma?.notificationTemplate.update({ where: { code: 'INVOICE_ISSUED' }, data: { bodyTemplate: original } });
    await moduleRef?.close();
  });

  async function migrateFrom(body: string): Promise<{ changed: number; after: string }> {
    await prisma.notificationTemplate.update({ where: { code: 'INVOICE_ISSUED' }, data: { bodyTemplate: body } });
    const changed = await prisma.$executeRawUnsafe(SQL);
    const after = (await prisma.notificationTemplate.findUniqueOrThrow({ where: { code: 'INVOICE_ISSUED' } })).bodyTemplate;
    return { changed, after };
  }

  it('bản "Hóa đơn" PROD đang giữ -> đổi sang "Hoá đơn" của seed', async () => {
    expect(await migrateFrom(OLD_BODY)).toEqual({ changed: 1, after: NEW_BODY });
  });

  it('bản admin đã sửa tay -> giữ nguyên', async () => {
    const custom = 'Hóa đơn VAT đơn {{order_code}} đã có, xem trong mục đơn hàng nhé.';
    expect(await migrateFrom(custom)).toEqual({ changed: 0, after: custom });
  });

  it('đã là chữ mới -> chạy lại không đổi gì', async () => {
    expect(await migrateFrom(NEW_BODY)).toEqual({ changed: 0, after: NEW_BODY });
  });
});
