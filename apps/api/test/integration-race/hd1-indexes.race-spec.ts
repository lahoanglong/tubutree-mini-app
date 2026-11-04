import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Gói hd1: các index phục vụ truy vấn nóng phải có đúng cột/thứ tự/điều kiện từng phần. Prisma không biểu diễn được
 * index một phần nên drift check không bắt được việc migration bị đổi hay bỏ; so định nghĩa thật trong pg_indexes.
 */
describe('hd1: định nghĩa index (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function def(name: string): Promise<string> {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = ${name}`;
    return rows[0]?.indexdef ?? '';
  }

  it('L3-10: hộp tin và số chưa đọc dùng index (userId, channel, ...) kể cả khi Prisma chạy prepared statement bằng generic plan', async () => {
    // Index một phần WHERE channel='INAPP' không bao giờ được chọn khi channel là tham số ($n); phải là index thường có channel trong khoá.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_generic_plan');
      const prepared: string[] = [];
      const prepare = async (name: string, sql: string) => {
        await tx.$executeRawUnsafe(`PREPARE ${name} ${sql}`);
        prepared.push(name);
      };
      try {
        await prepare(
          'hd1_feed(text, text, int)',
          `AS SELECT id FROM notification_logs WHERE "userId" = $1 AND channel = $2 ORDER BY "sentAt" DESC, id DESC LIMIT $3`,
        );
        await prepare(
          'hd1_unread(text, text, text)',
          `AS SELECT count(*) FROM notification_logs WHERE "userId" = $1 AND channel = $2 AND status <> $3`,
        );
        const feed = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN EXECUTE hd1_feed('u', 'INAPP', 20)`);
        const unread = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN EXECUTE hd1_unread('u', 'INAPP', 'READ')`);
        return {
          feed: feed.map((r) => r['QUERY PLAN']).join('\n'),
          unread: unread.map((r) => r['QUERY PLAN']).join('\n'),
        };
      } finally {
        // PREPARE sống theo kết nối chứ không theo transaction: gỡ đúng câu mình tạo (không DEALLOCATE ALL, sẽ xoá cả câu Prisma
        // đang cache), và nuốt lỗi gỡ để không che lỗi gốc khi transaction đã hỏng.
        for (const name of prepared) {
          await tx.$executeRawUnsafe(`DEALLOCATE ${name.split('(')[0]}`).catch(() => undefined);
        }
      }
    });
    expect(plan.feed).toContain('notification_logs_userId_channel_sentAt_id_idx');
    expect(plan.unread).toContain('notification_logs_userId_channel_status_idx');
  });

  it('L3-10: định nghĩa hai index hộp tin không có WHERE', async () => {
    expect(await def('notification_logs_userId_channel_sentAt_id_idx')).toMatch(
      /\("userId", channel, "sentAt" DESC, id DESC\)$/,
    );
    expect(await def('notification_logs_userId_channel_status_idx')).toMatch(/\("userId", channel, status\)$/);
  });

  it('voucher mốc: index theo hậu tố kỳ 8 ký tự của reason và id, chỉ dòng code MILESTONE%', async () => {
    expect(await def('coupons_milestone_period_idx')).toMatch(
      /\("right"\(\("scopeMeta" ->> 'reason'::text\), 8\), id\) WHERE \(code ~~ 'MILESTONE%'::text\)$/,
    );
  });

  it('khách vãng lai: index một phần theo id với đủ ba điều kiện role, phone, zaloId khớp literal của câu đếm', async () => {
    expect(await def('users_guest_idx')).toMatch(
      /\(id\) WHERE \(\(role = 'CUSTOMER'::"UserRole"\) AND \(phone IS NULL\) AND \("zaloId" ~~ 'guest_%'::text\)\)$/,
    );
  });

  it('L3-11: lịch sử điểm của khách theo (userId, createdAt DESC, id DESC) đúng thứ tự keyset của getPointsTransactions', async () => {
    expect(await def('points_transactions_userId_createdAt_id_idx')).toMatch(
      /\("userId", "createdAt" DESC, id DESC\)$/,
    );
  });

  it('L3-14: bảng tin xếp "mới" theo (status, isPinned DESC, createdAt DESC, id DESC) đúng orderBy của getFeed và xem trước công khai', async () => {
    expect(await def('feed_posts_status_isPinned_createdAt_id_idx')).toMatch(
      /\(status, "isPinned" DESC, "createdAt" DESC, id DESC\)$/,
    );
  });

  it('L3-13: đánh giá công khai theo (productId, isVisible, createdAt DESC) đúng where + orderBy của listByProduct', async () => {
    expect(await def('reviews_productId_isVisible_createdAt_idx')).toMatch(
      /\("productId", "isVisible", "createdAt" DESC\)$/,
    );
  });
});
