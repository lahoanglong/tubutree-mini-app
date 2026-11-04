import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Gói hg: truy vấn quét log ZNS kẹt (channel + status + sentAt) phải có index riêng, kể cả khi Prisma chạy prepared statement bằng generic plan. */
const SEED = 'hg-idx-';

describe('hg: index quét log ZNS kẹt (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    // Phần lớn log đã SENT, chỉ ~1% còn PENDING/RETRYING: đúng hình dạng PROD, để planner có lý do chọn index chọn lọc.
    await prisma.$executeRawUnsafe(
      `INSERT INTO notification_logs (id, "userId", "templateCode", channel, payload, status, "sentAt")
       SELECT '${SEED}'||g, 'hgu'||(g % 200), 'T', CASE WHEN g % 2 = 0 THEN 'ZNS' ELSE 'INAPP' END, '{}'::jsonb,
              CASE WHEN g % 100 = 0 THEN 'PENDING' WHEN g % 100 = 1 THEN 'RETRYING' ELSE 'SENT' END, now() - (g || ' minutes')::interval
       FROM generate_series(1, 8000) g`,
    );
    await prisma.$executeRawUnsafe('ANALYZE notification_logs');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.notificationLog.deleteMany({ where: { id: { startsWith: SEED } } });
      await prisma.$executeRawUnsafe('ANALYZE notification_logs');
    }
    await moduleRef?.close();
  });

  /**
   * EXPLAIN truy vấn của cron cho một trạng thái trong một transaction rồi ROLLBACK (mọi SET LOCAL và DDL thử đều bị huỷ).
   * Câu PREPARE sống theo kết nối chứ không theo transaction: gỡ đúng câu mình tạo (không DEALLOCATE ALL, sẽ xoá câu Prisma đang cache).
   */
  async function explainStuck(mode: 'force_custom_plan' | 'force_generic_plan', setup: string[] = []): Promise<string> {
    let plan = '';
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        await tx.$executeRawUnsafe(`SET LOCAL plan_cache_mode = ${mode}`);
        for (const sql of setup) await tx.$executeRawUnsafe(sql);
        let prepared = false;
        try {
          await tx.$executeRawUnsafe(
            `PREPARE hg_stuck(text, text, timestamp, text, int) AS
             SELECT id, status FROM notification_logs
              WHERE channel = $1 AND status = $2 AND "sentAt" < $3 AND (error IS NULL OR error NOT LIKE $4)
              ORDER BY "sentAt" ASC LIMIT $5`,
          );
          prepared = true;
          const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
            `EXPLAIN EXECUTE hg_stuck('ZNS', 'PENDING', now() - interval '1 hour', 'Chờ đối soát tay: %', 200)`,
          );
          plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        } finally {
          if (prepared) await tx.$executeRawUnsafe('DEALLOCATE hg_stuck').catch(() => undefined);
        }
        throw new Error('rollback');
      })
      .catch((err: Error) => {
        if (err.message !== 'rollback') throw err;
      });
    return plan;
  }

  it('lượt đầu của prepared statement (plan theo tham số thật): đi index (channel, status, sentAt)', async () => {
    expect(await explainStuck('force_custom_plan')).toContain('notification_logs_channel_status_sentAt_idx');
  });

  it('generic plan: index dùng được cho truy vấn (khi index sentAt đơn bị gỡ thử trong transaction rồi huỷ, planner vẫn đi index mới, không rơi về quét bảng)', async () => {
    // Với generic plan planner không biết `status` hiếm nên có thể thích đi index sentAt rồi lọc; điều cần chứng minh là index mới khớp truy vấn.
    const plan = await explainStuck('force_generic_plan', ['DROP INDEX "notification_logs_sentAt_idx"']);
    expect(plan).toContain('notification_logs_channel_status_sentAt_idx');
  });

  it('định nghĩa index: thường (không WHERE), đúng thứ tự cột channel, status, sentAt', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'notification_logs_channel_status_sentAt_idx'`;
    const def = rows[0]?.indexdef ?? '';
    expect(def).toContain('(channel, status, "sentAt")');
    expect(def).not.toContain('WHERE');
  });
});
