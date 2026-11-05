import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ZNS_REVIEW_PREFIX } from '../../src/modules/notifications/zns-review-prefix';
import { createUser, uniquePhone, warmPool } from './helpers';

const RUNBOOK = readFileSync(join(__dirname, '../../../../docs/launch/deploy-rollback-runbook.md'), 'utf8');

/** Lấy hai câu SQL đối soát tay trong runbook 1.20 (bước 3 ghi SENT, bước 4 đóng FAILED) để chạy thật trên Postgres. */
function reviewSql(): { sent: string; failed: string } {
  const start = RUNBOOK.indexOf('**Đối soát log ZNS "Chờ đối soát tay" (xử lý tay).**');
  const end = RUNBOOK.indexOf('**Lên bản mới.** Job `inapp-retry`', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const blocks = [...RUNBOOK.slice(start, end).matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => (m[1] as string).trim());
  expect(blocks).toHaveLength(2);
  return { sent: blocks[0] as string, failed: blocks[1] as string };
}

describe('runbook 1.20: câu SQL đối soát log ZNS chạy được và đúng (real Postgres)', () => {
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

  const mk = async (over: { status?: string; error?: string | null; payload?: object }) => {
    const u = await createUser(prisma, { phone: uniquePhone() });
    return prisma.notificationLog.create({
      data: {
        userId: u.id,
        templateCode: 'IT_REVIEW',
        channel: 'ZNS',
        payload: over.payload ?? { data: { a: '1' } },
        status: over.status ?? 'RETRYING',
        error: over.error === undefined ? `${ZNS_REVIEW_PREFIX}không rõ` : over.error,
      },
    });
  };
  const run = (sql: string, id: string) => prisma.$executeRawUnsafe(sql.replaceAll('<id>', id).replaceAll('<lý do đối soát>', 'đã tra Zalo'));
  const row = (id: string) => prisma.notificationLog.findUniqueOrThrow({ where: { id } });

  it('bước 3: log đã đánh dấu thành SENT, xoá error, trả đúng 1 dòng; chạy lần hai trả 0 (CAS)', async () => {
    const { sent } = reviewSql();
    const log = await mk({ payload: { data: {}, dedupeKey: 'k-sent', dedupeWithinMs: 3_600_000 } });
    expect(await run(sent, log.id)).toBe(1);
    const after = await row(log.id);
    expect([after.status, after.error]).toEqual(['SENT', null]);
    expect(after.payload).toEqual({ data: {}, dedupeKey: 'k-sent', dedupeWithinMs: 3_600_000 });
    expect(await run(sent, log.id)).toBe(0);
  });

  it('bước 3: nếu gặp khoá đã nhả của chính log thì khôi phục khoá gốc', async () => {
    const { sent } = reviewSql();
    const log = await mk({});
    await prisma.notificationLog.update({ where: { id: log.id }, data: { payload: { data: {}, dedupeKey: `k-restore:failed:${log.id}` } } });
    expect(await run(sent, log.id)).toBe(1);
    expect((await row(log.id)).payload).toEqual({ data: {}, dedupeKey: 'k-restore' });
  });

  it('bước 4: log đã đánh dấu thành FAILED kèm lý do và nhả khoá, giữ data và dedupeWithinMs; trả 1 dòng', async () => {
    const { failed } = reviewSql();
    const log = await mk({ status: 'PENDING', payload: { data: { a: '1' }, dedupeKey: 'k-fail', dedupeWithinMs: 60_000 } });
    expect(await run(failed, log.id)).toBe(1);
    const after = await row(log.id);
    expect(after.status).toBe('FAILED');
    expect(after.error).toBe('Đối soát tay: Zalo chưa nhận tin (đã tra Zalo)');
    expect(after.payload).toEqual({ data: { a: '1' }, dedupeKey: `k-fail:failed:${log.id}`, dedupeWithinMs: 60_000 });
  });

  it('bước 4: log không có khoá giữ payload; log không mang tiền tố hoặc đã SENT thì không bị đụng (trả 0)', async () => {
    const { failed } = reviewSql();
    const plain = await mk({});
    expect(await run(failed, plain.id)).toBe(1);
    expect((await row(plain.id)).payload).toEqual({ data: { a: '1' } });
    const unmarked = await mk({ error: 'lỗi khác' });
    expect(await run(failed, unmarked.id)).toBe(0);
    const sent = await mk({ status: 'SENT', error: `${ZNS_REVIEW_PREFIX}x` });
    expect(await run(failed, sent.id)).toBe(0);
    expect((await row(sent.id)).status).toBe('SENT');
  });

  it('bước 4: khoá đã nhả rồi thì không nối :failed: lần hai', async () => {
    const { failed } = reviewSql();
    const log = await mk({});
    await prisma.notificationLog.update({ where: { id: log.id }, data: { payload: { data: {}, dedupeKey: `k-twice:failed:${log.id}` } } });
    expect(await run(failed, log.id)).toBe(1);
    expect((await row(log.id)).payload).toEqual({ data: {}, dedupeKey: `k-twice:failed:${log.id}` });
  });
});
