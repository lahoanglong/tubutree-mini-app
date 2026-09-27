import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import './setup-env'; // guard DATABASE_URL phải trỏ tubutree_it, theo đúng convention có sẵn

// Không import AnalyticsModule trực tiếp: module đó còn khai AnalyticsController (dùng
// DeviceThrottlerGuard extends ThrottlerGuard, đòi THROTTLER:MODULE_OPTIONS) và
// AnalyticsAggregationService — không cần cho test atomic này, và compile() sẽ CRASH vì thiếu
// ThrottlerModule (đã xác nhận thực tế khi chạy thử). Convention có sẵn (affiliate.race-spec.ts,
// cũng test chính AnalyticsEventsService) đã né vấn đề này bằng cách khai thẳng service làm
// provider thay vì import cả module — theo đúng cách đó.
describe('AnalyticsEventsService — atomic với transaction rollback (Postgres thật)', () => {
  it('transaction rollback → KHÔNG có dòng analytics_events mồ côi', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [AnalyticsEventsService],
    }).compile();
    const prisma = moduleRef.get(PrismaService);
    const analytics = moduleRef.get(AnalyticsEventsService);
    const eventId = `test-rollback-${Date.now()}`;

    await expect(
      prisma.$transaction(async (tx) => {
        await analytics.record(tx, { eventId, eventName: 'order_placed', platform: 'miniapp' });
        throw new Error('giả lập lỗi nghiệp vụ sau khi ghi event — phải rollback CẢ event');
      }),
    ).rejects.toThrow('giả lập lỗi nghiệp vụ');

    const orphan = await prisma.analyticsEvent.findUnique({ where: { eventId } });
    expect(orphan).toBeNull();

    await moduleRef.close();
  });

  it('transaction commit thành công → dòng analytics_events tồn tại', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [AnalyticsEventsService],
    }).compile();
    const prisma = moduleRef.get(PrismaService);
    const analytics = moduleRef.get(AnalyticsEventsService);
    const eventId = `test-commit-${Date.now()}`;

    await prisma.$transaction(async (tx) => {
      await analytics.record(tx, { eventId, eventName: 'order_placed', platform: 'miniapp' });
    });

    const saved = await prisma.analyticsEvent.findUnique({ where: { eventId } });
    expect(saved).not.toBeNull();

    await prisma.analyticsEvent.delete({ where: { eventId } }); // dọn dữ liệu test
    await moduleRef.close();
  });
});
