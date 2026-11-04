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

  it('L3-10: tin in-app theo (userId, sentAt DESC, id DESC) chỉ kênh INAPP; tin chưa đọc chỉ INAPP và status <> READ', async () => {
    expect(await def('notification_logs_inapp_feed_idx')).toMatch(
      /\("userId", "sentAt" DESC, id DESC\) WHERE \(channel = 'INAPP'::text\)$/,
    );
    expect(await def('notification_logs_inapp_unread_idx')).toMatch(
      /\("userId"\) WHERE \(\(channel = 'INAPP'::text\) AND \(status <> 'READ'::text\)\)$/,
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
});
