import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BADGE_IDS, type BadgeId, type BadgesResponse } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { CRON_TZ } from '../../../common/cron-tz';
import { TrackCron, markCronSkipped } from '../../../common/cron-run/track-cron';
import { BADGES_ENABLED_KEY, readEngagementFlag } from './daily-missions';
import { grantBadgeSql } from './badges';

/** Lần mở hàng huy hiệu gần nhất đã chấm lại cho khách này: mở lại trong khoảng này chỉ đọc, không chạy 8 câu cấp. */
const REGRANT_MS = 60_000;
const REGRANT_MEMO_MAX = 5_000;

/**
 * Huy hiệu ghi nhận (cờ engagement.badges_enabled), 0 điểm, không gửi thông báo. Cấp ở hai chỗ, cùng câu SQL (badges.ts): job đêm cho mọi
 * khách và lúc khách mở hàng huy hiệu (chỉ khách đó), để việc vừa làm (đơn vừa giao, đánh giá vừa gửi) hiện ngay mà không phải sửa
 * module đơn, đánh giá hay Đổi rác. Cờ tắt thì không cấp gì và API trả `enabled: false`.
 */
@Injectable()
export class BadgesService {
  private readonly logger = new Logger(BadgesService.name);
  private readonly lastGrant = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async list(userId: string, now: Date = new Date()): Promise<BadgesResponse> {
    if (!(await readEngagementFlag(this.config, BADGES_ENABLED_KEY))) return { enabled: false, badges: [] };
    const last = this.lastGrant.get(userId);
    if (last === undefined || now.getTime() - last >= REGRANT_MS) {
      await this.award(userId, now);
      if (this.lastGrant.size >= REGRANT_MEMO_MAX) this.lastGrant.clear();
      this.lastGrant.set(userId, now.getTime());
    }
    const rows = await this.prisma.userBadge.findMany({ where: { userId }, select: { badge: true, earnedAt: true } });
    const earned = new Map(rows.map((r) => [r.badge, r.earnedAt]));
    return {
      enabled: true,
      badges: BADGE_IDS.map((id) => {
        const at = earned.get(id);
        return { id, earned: at !== undefined, earnedAt: at ? at.toISOString() : null };
      }),
    };
  }

  /** Cấp mọi huy hiệu đã đạt cho một khách (`userId`) hoặc mọi khách (null). Trả số dòng mới theo huy hiệu. */
  async award(userId: string | null, now: Date = new Date()): Promise<Record<BadgeId, number>> {
    const added = {} as Record<BadgeId, number>;
    for (const badge of BADGE_IDS) added[badge] = await this.prisma.$executeRaw(grantBadgeSql(badge, userId, now));
    return added;
  }

  @Cron('40 3 * * *', { timeZone: CRON_TZ })
  @TrackCron()
  async grantNightly(): Promise<void> {
    if (!(await readEngagementFlag(this.config, BADGES_ENABLED_KEY))) {
      markCronSkipped('NOT_CONFIGURED');
      return;
    }
    try {
      const added = await this.award(null);
      const total = Object.values(added).reduce((a, b) => a + b, 0);
      if (total > 0) this.logger.log(`Huy hiệu mới: ${JSON.stringify(added)}`);
    } catch (err) {
      this.logger.error(`grantNightly lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }
}
