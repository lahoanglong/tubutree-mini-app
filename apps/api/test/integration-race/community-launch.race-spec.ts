import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { CommunityFeedService } from '../../src/modules/feed/community-feed.service';
import { CommunityRewardService } from '../../src/modules/feed/community-reward.service';
import { countUnansweredQuestions, listUnansweredQuestions } from '../../src/modules/feed/community-unanswered';
import { OpsInboxService } from '../../src/modules/ops/ops-inbox.service';
import type { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { createOrder, createUser, setConfig, summarize, warmPool } from './helpers';

const HOUR = 3_600_000;

/**
 * Launch review (gói cộng đồng): đường SQL thô của "câu hỏi chưa ai trả lời" và việc gộp tin tương tác theo bài đều phải đúng
 * trên Postgres thật — mock Prisma không bắt được NOT EXISTS sai hay hai lượt thích song song cùng lọt qua khoá gộp.
 */
describe('Cộng đồng: câu hỏi chưa trả lời, gộp tin tương tác, ẩn bài (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let feed: CommunityFeedService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        { provide: CommunityRewardService, useValue: { rewardPost: jest.fn(), rewardAnswer: jest.fn() } },
        {
          provide: NotificationsService,
          useFactory: (db: PrismaService, analytics: AnalyticsEventsService) =>
            new NotificationsService(db, { sendTemplate: jest.fn() } as unknown as ZnsClient, analytics),
          inject: [PrismaService, AnalyticsEventsService],
        },
        CommunityFeedService,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    feed = moduleRef.get(CommunityFeedService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const post = (userId: string, over: Record<string, unknown> = {}) =>
    prisma.feedPost.create({ data: { userId, body: 'Bài IT', status: 'PUBLISHED', ...over } });
  const logs = (userId: string, templateCode: string) => prisma.notificationLog.findMany({ where: { userId, templateCode }, orderBy: { sentAt: 'asc' } });

  describe('câu hỏi chưa ai trả lời quá ngưỡng (SQL thô)', () => {
    const cutoff = () => new Date(Date.now() - 24 * HOUR);
    const old = () => new Date(Date.now() - 30 * HOUR);

    it('chỉ đếm/liệt kê câu hỏi đã đăng, đủ cũ, chưa có bình luận còn hiện của người KHÁC chủ bài; cũ nhất trước', async () => {
      const author = await createUser(prisma, { fullName: 'Chủ câu hỏi IT' });
      const other = await createUser(prisma);
      const category = await prisma.communityCategory.create({ data: { slug: `it-${Date.now()}`, name: 'Hỏi đáp IT' } });
      const before = await countUnansweredQuestions(prisma, cutoff());

      const waiting = await post(author.id, { kind: 'QUESTION', title: 'Chưa ai trả lời', createdAt: old(), categoryId: category.id });
      const olderWaiting = await post(author.id, { kind: 'QUESTION', title: 'Chờ lâu hơn', createdAt: new Date(Date.now() - 50 * HOUR), body: 'x'.repeat(500) });
      const selfOnly = await post(author.id, { kind: 'QUESTION', title: 'Chỉ tự bình luận', createdAt: old() });
      await prisma.feedComment.create({ data: { postId: selfOnly.id, userId: author.id, body: 'bổ sung thêm' } });
      const onlyRemoved = await post(author.id, { kind: 'QUESTION', title: 'Trả lời đã bị gỡ', createdAt: old() });
      await prisma.feedComment.create({ data: { postId: onlyRemoved.id, userId: other.id, body: 'spam', isRemoved: true } });

      const answered = await post(author.id, { kind: 'QUESTION', title: 'Đã có người trả lời', createdAt: old() });
      await prisma.feedComment.create({ data: { postId: answered.id, userId: other.id, body: 'Tưới ít lại nhé' } });
      const fresh = await post(author.id, { kind: 'QUESTION', title: 'Mới đăng', createdAt: new Date(Date.now() - 2 * HOUR) });
      const notQuestion = await post(author.id, { kind: 'SHOWCASE', createdAt: old() });
      const pending = await post(author.id, { kind: 'QUESTION', status: 'PENDING', createdAt: old() });
      const removed = await post(author.id, { kind: 'QUESTION', status: 'REMOVED', createdAt: old() });

      const after = await countUnansweredQuestions(prisma, cutoff());
      expect(after - before).toBe(4);

      const mine = new Set([waiting, olderWaiting, selfOnly, onlyRemoved, answered, fresh, notQuestion, pending, removed].map((p) => p.id));
      const rows = (await listUnansweredQuestions(prisma, cutoff(), 500)).filter((r) => mine.has(r.id));
      expect(rows.map((r) => r.id)).toEqual([olderWaiting.id, waiting.id, selfOnly.id, onlyRemoved.id]);
      const w = rows.find((r) => r.id === waiting.id)!;
      expect(w).toMatchObject({ title: 'Chưa ai trả lời', author: 'Chủ câu hỏi IT', category: 'Hỏi đáp IT' });
      expect(rows.find((r) => r.id === olderWaiting.id)!.excerpt).toHaveLength(200);
    });

    it('adminUnanswered tính số giờ đã chờ từ createdAt', async () => {
      const author = await createUser(prisma);
      const p = await post(author.id, { kind: 'QUESTION', title: 'Chờ 30 giờ', createdAt: old() });
      const rows = await feed.adminUnanswered(100);
      const row = rows.find((r) => r.id === p.id)!;
      expect(row.waitingHours).toBeGreaterThanOrEqual(29);
      expect(row.waitingHours).toBeLessThanOrEqual(30);
    });
  });

  describe('gộp tin tương tác theo bài', () => {
    it('8 người thả tim cùng lúc → đúng MỘT tin; một lượt thích không chặn tin bình luận; bình luận gộp với nhau; hết cửa sổ thì có tin mới', async () => {
      const author = await createUser(prisma);
      const p = await post(author.id, { kind: 'SHOWCASE', title: 'Ban công IT' });
      const fans = await Promise.all(Array.from({ length: 8 }, () => createUser(prisma)));

      const res = summarize(await Promise.allSettled(fans.map((u) => feed.toggleReaction(u.id, p.id))));
      expect(res.errors).toEqual([]);
      expect(await logs(author.id, 'COMMUNITY_POST_LIKED')).toHaveLength(1);

      await feed.addComment(fans[0]!.id, 'CUSTOMER', p.id, 'đẹp quá');
      const first = await logs(author.id, 'COMMUNITY_POST_COMMENTED');
      expect(first).toHaveLength(1);
      expect(JSON.stringify(first[0]!.payload)).toContain('Ban công IT');

      await feed.addComment(fans[1]!.id, 'CUSTOMER', p.id, 'cho mình hỏi giống cây');
      expect(await logs(author.id, 'COMMUNITY_POST_COMMENTED')).toHaveLength(1);

      // Tin cũ hơn cửa sổ 60 phút không còn chặn.
      await prisma.notificationLog.updateMany({ where: { userId: author.id }, data: { sentAt: new Date(Date.now() - 2 * HOUR) } });
      await feed.addComment(fans[2]!.id, 'CUSTOMER', p.id, 'bao lâu thì ra hoa');
      expect(await logs(author.id, 'COMMUNITY_POST_COMMENTED')).toHaveLength(2);
    });

    it('bài của người khác không lẫn: mỗi bài một khoá gộp riêng', async () => {
      const author = await createUser(prisma);
      const a = await post(author.id, { title: 'Bài A' });
      const b = await post(author.id, { title: 'Bài B' });
      const fan = await createUser(prisma);

      await feed.toggleReaction(fan.id, a.id);
      await feed.toggleReaction(fan.id, b.id);

      expect(await logs(author.id, 'COMMUNITY_POST_LIKED')).toHaveLength(2);
    });

    it('tự thả tim bài của mình → không có tin', async () => {
      const author = await createUser(prisma);
      const p = await post(author.id);
      await feed.toggleReaction(author.id, p.id);
      expect(await logs(author.id, 'COMMUNITY_POST_LIKED')).toHaveLength(0);
    });
  });

  describe('"Việc cần xử lý": cộng đồng và VAT', () => {
    const merchant = { countOverdue: async () => 0, countStoresToSettle: async () => 0 } as unknown as MerchantFulfilmentService;
    const delta = (after: { items: { key: string; count: number }[] }, before: { items: { key: string; count: number }[] }, key: string) =>
      (after.items.find((i) => i.key === key)?.count ?? 0) - (before.items.find((i) => i.key === key)?.count ?? 0);

    it('đếm bài chờ duyệt, câu hỏi chờ quá ngưỡng và đơn VAT chờ xuất bằng đúng điều kiện của các danh sách', async () => {
      const inbox = new OpsInboxService(prisma, merchant, moduleRef.get(SystemConfigService));
      const admin = { role: 'ADMIN', staffPermissions: [] as string[] };
      const before = await inbox.counts(admin);
      const author = await createUser(prisma);
      const other = await createUser(prisma);

      await post(author.id, { status: 'PENDING' });
      await post(author.id, { status: 'PUBLISHED' });
      await post(author.id, { kind: 'QUESTION', createdAt: new Date(Date.now() - 30 * HOUR) });
      const answered = await post(author.id, { kind: 'QUESTION', createdAt: new Date(Date.now() - 30 * HOUR) });
      await prisma.feedComment.create({ data: { postId: answered.id, userId: other.id, body: 'trả lời' } });
      await post(author.id, { kind: 'QUESTION', createdAt: new Date(Date.now() - 2 * HOUR) });

      await createOrder(prisma, { userId: author.id, invoiceStatus: 'REQUESTED' });
      await createOrder(prisma, { userId: author.id, invoiceStatus: 'FAILED' });
      await createOrder(prisma, { userId: author.id, invoiceStatus: 'ISSUED' });
      await createOrder(prisma, { userId: author.id, invoiceStatus: 'REQUESTED', status: 'CANCELLED' });

      const after = await inbox.counts(admin);
      expect(delta(after, before, 'communityPending')).toBe(1);
      expect(delta(after, before, 'communityUnanswered')).toBe(1);
      expect(delta(after, before, 'invoicePending')).toBe(2);

      const cskh = await inbox.counts({ role: 'STAFF', staffPermissions: ['CSKH'] });
      expect(cskh.items.map((i) => i.key)).toEqual(expect.arrayContaining(['communityPending', 'communityUnanswered']));
      expect(cskh.items.map((i) => i.key)).not.toContain('invoicePending');
    });

    it('khoá community.unanswered_alert_hours đổi ngưỡng đếm', async () => {
      // Đọc thẳng DB mỗi lần để không dính bộ nhớ đệm 60 giây của SystemConfigService.
      const liveConfig = { get: async (key: string, fallback: unknown) => (await prisma.systemConfig.findUnique({ where: { key } }))?.value ?? fallback };
      const inbox = new OpsInboxService(prisma, merchant, liveConfig as unknown as SystemConfigService);
      const unansweredWithin = async (hours: number) => {
        await setConfig(prisma, 'community.unanswered_alert_hours', hours);
        return (await inbox.counts({ role: 'ADMIN' })).items.find((i) => i.key === 'communityUnanswered')!.count;
      };
      const author = await createUser(prisma);

      try {
        const [fourBefore, dayBefore] = [await unansweredWithin(4), await unansweredWithin(24)];
        await post(author.id, { kind: 'QUESTION', createdAt: new Date(Date.now() - 5 * HOUR) });
        const [fourAfter, dayAfter] = [await unansweredWithin(4), await unansweredWithin(24)];
        expect(fourAfter - fourBefore).toBe(1);
        expect(dayAfter - dayBefore).toBe(0);
      } finally {
        await setConfig(prisma, 'community.unanswered_alert_hours', 24);
      }
    });
  });

  describe('kiểm duyệt ẩn bài', () => {
    it('hidePost: bài REMOVED, tác giả nhận đúng một tin có lý do, gọi lại không báo thêm', async () => {
      const author = await createUser(prisma);
      const p = await post(author.id, { title: 'Bài vi phạm IT' });

      await feed.hidePost(p.id, 'Có link bán hàng ngoài');
      await feed.hidePost(p.id, 'Có link bán hàng ngoài');

      expect((await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('REMOVED');
      const sent = await logs(author.id, 'COMMUNITY_POST_HIDDEN');
      expect(sent).toHaveLength(1);
      const body = (sent[0]!.payload as { body: string }).body;
      expect(body).toContain('Bài vi phạm IT');
      expect(body).toContain('Có link bán hàng ngoài');
    });

    it('duyệt rồi từ chối (màn hình cũ của CSKH) → 409, bài vẫn PUBLISHED, tác giả chỉ nhận tin "đã duyệt"', async () => {
      const author = await createUser(prisma);
      const p = await post(author.id, { status: 'PENDING' });

      await feed.approvePost(p.id);
      await expect(feed.rejectPost(p.id, 'stale')).rejects.toBeInstanceOf(ConflictException);

      expect((await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('PUBLISHED');
      expect(await logs(author.id, 'COMMUNITY_POST_APPROVED')).toHaveLength(1);
      expect(await logs(author.id, 'COMMUNITY_POST_REJECTED')).toHaveLength(0);
    });

    it('nhiều CSKH từ chối cùng một bài cùng lúc → không lỗi, đúng MỘT tin "chưa được đăng"', async () => {
      const author = await createUser(prisma);
      const p = await post(author.id, { status: 'PENDING' });

      const res = summarize(await Promise.allSettled(['a', 'b', 'c', 'd'].map((reason) => feed.rejectPost(p.id, reason))));

      expect(res.errors).toEqual([]);
      expect((await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('REMOVED');
      expect(await logs(author.id, 'COMMUNITY_POST_REJECTED')).toHaveLength(1);
    });

    it('duyệt và từ chối cùng lúc → đúng MỘT kết cục nhất quán (không có bài REMOVED mà tác giả vẫn nhận "đã duyệt")', async () => {
      for (let round = 0; round < 5; round += 1) {
        const author = await createUser(prisma);
        const p = await post(author.id, { status: 'PENDING' });

        const settled = await Promise.allSettled([feed.approvePost(p.id), feed.rejectPost(p.id, 'x')]);

        const unexpected = settled.filter((r) => r.status === 'rejected' && !(r.reason instanceof ConflictException));
        expect(unexpected).toEqual([]);
        const status = (await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } })).status;
        const approved = await logs(author.id, 'COMMUNITY_POST_APPROVED');
        const rejected = await logs(author.id, 'COMMUNITY_POST_REJECTED');
        if (status === 'PUBLISHED') {
          expect([approved.length, rejected.length]).toEqual([1, 0]);
        } else {
          expect(status).toBe('REMOVED');
          expect([approved.length, rejected.length]).toEqual([0, 1]);
        }
      }
    });

    it('hidePost trên bài PENDING → 409, bài vẫn PENDING, không có tin "đã được ẩn"', async () => {
      const author = await createUser(prisma);
      const p = await post(author.id, { status: 'PENDING' });

      await expect(feed.hidePost(p.id, 'x')).rejects.toBeInstanceOf(ConflictException);

      expect((await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('PENDING');
      expect(await logs(author.id, 'COMMUNITY_POST_HIDDEN')).toHaveLength(0);
    });

    it('nhiều CSKH ẩn cùng một bài cùng lúc → không lỗi và tác giả chỉ nhận đúng MỘT tin', async () => {
      const author = await createUser(prisma);
      const p = await post(author.id);
      const res = summarize(await Promise.allSettled(['a', 'b', 'c', 'd', 'e', 'f'].map((reason) => feed.hidePost(p.id, reason))));
      expect(res.errors).toEqual([]);
      expect((await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('REMOVED');
      expect(await logs(author.id, 'COMMUNITY_POST_HIDDEN')).toHaveLength(1);
    });

    it('ẩn và ADMIN xoá cùng lúc một bài → cũng chỉ MỘT tin báo ẩn', async () => {
      const author = await createUser(prisma);
      const admin = await createUser(prisma);
      const p = await post(author.id);
      const res = summarize(
        await Promise.allSettled([feed.hidePost(p.id, 'a'), feed.deletePost(admin.id, 'ADMIN', p.id), feed.hidePost(p.id, 'b'), feed.deletePost(admin.id, 'ADMIN', p.id)]),
      );
      expect(res.errors).toEqual([]);
      expect(await logs(author.id, 'COMMUNITY_POST_HIDDEN')).toHaveLength(1);
    });
  });
});
