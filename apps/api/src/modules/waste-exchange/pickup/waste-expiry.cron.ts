import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { CRON_TZ } from '../../../common/cron-tz';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { WasteShipLockService } from '../core/waste-ship-lock.service';
import { GOMDON_DISPATCHED_STATUSES } from '../waste.constants';
import { vnMonthKey } from '../../../common/vn-time';
import { markCronSkipped, TrackCron } from '../../../common/cron-run/track-cron';
import { runExclusive } from '../../../common/cron-leader/run-exclusive';

const PAGE = 200;
const HOUR_MS = 3_600_000;
/** Cron chạy mỗi ngày nên cửa sổ [24 giờ, 48 giờ) tới hạn ghép kín: mỗi yêu cầu rơi vào đúng một lượt chạy. */
const REMIND_FROM_HOURS = 24;
const REMIND_TO_HOURS = 48;

type ExpiryCloseReason = 'HOLD_EXPIRED' | 'PICKUP_NO_SHOW' | 'PICKUP_NOT_DISPATCHED';

/** §12.2 bước 4: chỉ vận đơn đã tới tay bưu tá (3, 4, 5, 7) mới là khách không giao; không phân loại theo gomdonOrderId. */
export function expiryCloseReason(row: { status: 'OPEN' | 'IN_TRANSIT'; gomdonStatus: string | null }): ExpiryCloseReason {
  if (row.status === 'OPEN') return 'HOLD_EXPIRED';
  if (row.gomdonStatus !== null && (GOMDON_DISPATCHED_STATUSES as readonly string[]).includes(row.gomdonStatus)) return 'PICKUP_NO_SHOW';
  return 'PICKUP_NOT_DISPATCHED';
}

type Candidate = { id: string; code: string; userId: string; method: 'DROP_OFF' | 'MAIL_IN' | 'PICKUP'; status: string; orderId: string | null };

@Injectable()
export class WasteExpiryCron {
  private readonly logger = new Logger(WasteExpiryCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly notifier: WasteNotifierService,
    private readonly shipLock: WasteShipLockService,
    private readonly access: WasteAccessService,
  ) {}

  // @Cron không tự bắt lỗi: lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 30 3 * * *', { name: 'waste.expiry', timeZone: CRON_TZ })
  @TrackCron()
  async handleCron(): Promise<void> {
    try {
      const res = await this.run();
      if (res.expired > 0) this.logger.log(`Hết hạn yêu cầu đổi rác: đóng ${res.expired} yêu cầu.`);
    } catch (err) {
      this.logger.error(`Cron hết hạn yêu cầu đổi rác lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async run(now: Date = new Date()): Promise<{ expired: number }> {
    if (this.running) { markCronSkipped('RUNNING'); return { expired: 0 }; }
    this.running = true;
    try {
      const cfg = await this.config.snapshot();
      // Khoá lượt chạy (cron_leases), không giữ kết nối DB: nhiều instance cùng lên lịch thì chỉ một chạy.
      const run = await runExclusive(this.prisma, 'cron:waste.expiry', () => this.sweep(now, cfg));
      if (!run.acquired) { markCronSkipped('LOCKED'); return { expired: 0 }; }
      return run.value;
    } finally {
      this.running = false;
    }
  }

  private async sweep(now: Date, cfg: { enabled: boolean; shortfallLockPct: number; shortfallLockStreak: number }): Promise<{ expired: number }> {
    const base: Prisma.WasteRequestWhereInput = {
      expiresAt: { lt: now },
      OR: [{ status: 'OPEN', orderId: null }, { status: 'IN_TRANSIT', method: 'PICKUP' }],
    };
    const noShowUsers = new Set<string>();
    let expired = 0;
    let lastId: string | null = null;
    for (;;) {
      const page: Candidate[] = await this.prisma.wasteRequest.findMany({
        where: lastId === null ? base : { AND: [base, { id: { gt: lastId } }] },
        select: { id: true, code: true, userId: true, method: true, status: true, orderId: true },
        orderBy: { id: 'asc' },
        take: PAGE,
      });
      for (const row of page) {
        try {
          const closed = await this.closeRow(row, now);
          if (!closed) continue;
          expired += 1;
          await this.notifier.requestExpired(row.userId, { id: row.id, code: row.code, method: row.method }, closed, now);
          if (closed === 'PICKUP_NO_SHOW') noShowUsers.add(row.userId);
        } catch (err) {
          this.logger.error(`Đóng yêu cầu hết hạn ${row.id} lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
        }
      }
      if (page.length < PAGE) break;
      lastId = page[page.length - 1]!.id;
    }
    for (const userId of noShowUsers) {
      try {
        await this.shipLock.evaluateAndLock(userId, { shortfallLockPct: cfg.shortfallLockPct, shortfallLockStreak: cfg.shortfallLockStreak });
      } catch (err) {
        this.logger.error(`Xét khoá giao hàng cho ${userId} lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
      }
    }
    await this.remindExpiring(now, cfg.enabled);
    return { expired };
  }

  /**
   * Nhắc khách còn khoảng một đến hai ngày giữ chỗ. MAIL_IN đã nhập mã vận đơn chuyển sang IN_TRANSIT và không còn hạn nên không vào đây;
   * `trackingCode: null` giữ điều đó ngay cả khi trạng thái chưa kịp đổi. Tin trùng bị chặn bằng dedupeKey theo id yêu cầu.
   * Chỉ nhắc khi khách làm theo được: chương trình tắt thì quầy từ chối nhận mang tới, khách bị khoá thì kho không cộng điểm,
   * và màn yêu cầu của họ đang nói "tạm dừng" (pausedNote). Yêu cầu DROP_OFF mà điểm nhận đã tạm dừng, mất chủ hợp lệ hay hết hạn mức
   * tháng cũng bị bỏ qua: tin bảo mang rác tới một quầy không nhận được là chuyến đi vô ích. Hạn giữ chỗ vẫn chạy ở bước đóng, không phụ thuộc cờ.
   */
  private async remindExpiring(now: Date, programmeEnabled: boolean): Promise<void> {
    if (!programmeEnabled) return;
    const base: Prisma.WasteRequestWhereInput = {
      status: 'OPEN',
      orderId: null,
      trackingCode: null,
      method: { in: ['DROP_OFF', 'MAIL_IN'] },
      user: { isBlocked: false, mergedIntoId: null, OR: [{ wasteFlags: null }, { wasteFlags: { blockedAt: null } }] },
      expiresAt: { gte: new Date(now.getTime() + REMIND_FROM_HOURS * HOUR_MS), lt: new Date(now.getTime() + REMIND_TO_HOURS * HOUR_MS) },
    };
    try {
      let lastId: string | null = null;
      for (;;) {
        const page: { id: string; code: string; userId: string; pointId: string; method: 'DROP_OFF' | 'MAIL_IN' | 'PICKUP'; expiresAt: Date | null }[] = await this.prisma.wasteRequest.findMany({
          where: lastId === null ? base : { AND: [base, { id: { gt: lastId } }] },
          select: { id: true, code: true, userId: true, pointId: true, method: true, expiresAt: true },
          orderBy: { id: 'asc' },
          take: PAGE,
        });
        const dropOff = page.filter((r) => r.method === 'DROP_OFF' && r.expiresAt);
        const unusable = await this.unusablePointIds(dropOff.map((r) => r.pointId), now, [...new Set(dropOff.filter((r) => vnMonthKey(r.expiresAt!) === vnMonthKey(now)).map((r) => r.pointId))]);
        for (const row of page) {
          if (!row.expiresAt || row.method === 'PICKUP') continue;
          if (row.method === 'DROP_OFF' && (unusable.bad.has(row.pointId) || (unusable.quotaFull.has(row.pointId) && vnMonthKey(row.expiresAt) === vnMonthKey(now)))) continue;
          try {
            await this.notifier.requestExpiring(row.userId, { id: row.id, code: row.code }, row.method, row.expiresAt);
          } catch (err) {
            this.logger.error(`Nhắc yêu cầu sắp hết hạn ${row.id} lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
          }
        }
        if (page.length < PAGE) break;
        lastId = page[page.length - 1]!.id;
      }
    } catch (err) {
      this.logger.error(`Quét nhắc yêu cầu sắp hết hạn lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  /**
   * `bad`: điểm không ACTIVE hoặc mất chủ hợp lệ (availablePointIds). `quotaFull`: PARTNER đã dùng hết hạn mức của tháng VN hiện tại, chỉ xét cho `quotaPointIds`
   * (điểm có yêu cầu hết hạn ngay trong tháng này). Yêu cầu có hạn sang tháng sau thì hạn mức đã về 0 khi khách tới, nên không bị coi là hết hạn mức.
   */
  private async unusablePointIds(pointIds: string[], now: Date, quotaPointIds: string[]): Promise<{ bad: Set<string>; quotaFull: Set<string> }> {
    const ids = [...new Set(pointIds)];
    const bad = new Set<string>();
    const quotaFull = new Set<string>();
    if (ids.length === 0) return { bad, quotaFull };
    const available = await this.access.availablePointIds(this.prisma, ids);
    for (const id of ids) if (!available.has(id)) bad.add(id);
    const quotaPoints = await this.prisma.wastePoint.findMany({
      where: { id: { in: quotaPointIds.filter((id) => available.has(id)) }, kind: 'PARTNER', monthlyQuotaPoints: { not: null } },
      select: { id: true, monthlyQuotaPoints: true },
    });
    if (quotaPoints.length === 0) return { bad, quotaFull };
    const usage = await this.prisma.wastePointUsage.findMany({
      where: { pointId: { in: quotaPoints.map((p) => p.id) }, monthKey: vnMonthKey(now) },
      select: { pointId: true, pointsUsed: true },
    });
    const used = new Map(usage.map((u) => [u.pointId, u.pointsUsed]));
    for (const p of quotaPoints) if ((used.get(p.id) ?? 0) >= (p.monthlyQuotaPoints ?? 0)) quotaFull.add(p.id);
    return { bad, quotaFull };
  }

  /** Một transaction ngắn cho một dòng; không lấy khoá nào khác (rule 15). Trả lý do đóng khi dòng trúng điều kiện. */
  private closeRow(row: Candidate, now: Date): Promise<ExpiryCloseReason | null> {
    return this.prisma.$transaction(async (tx) => {
      const inTransit = row.status === 'IN_TRANSIT';
      const gomdonStatus =
        inTransit && row.orderId ? ((await tx.order.findUnique({ where: { id: row.orderId }, select: { gomdonStatus: true } }))?.gomdonStatus ?? null) : null;
      const closeReason = expiryCloseReason({ status: inTransit ? 'IN_TRANSIT' : 'OPEN', gomdonStatus });
      const data = { status: 'EXPIRED' as const, closedAt: now, closeReason };
      const { count } = inTransit
        ? await tx.wasteRequest.updateMany({ where: { id: row.id, status: 'IN_TRANSIT', method: 'PICKUP', orderId: row.orderId, expiresAt: { lt: now } }, data })
        : await tx.wasteRequest.updateMany({ where: { id: row.id, status: 'OPEN', orderId: null, expiresAt: { lt: now } }, data });
      if (count !== 1) return null;
      await writeWasteEvent(tx, {
        kind: 'REQUEST_EXPIRED',
        actorUserId: null,
        actorRole: 'SYSTEM',
        requestId: row.id,
        meta: { closeReason, method: row.method, before: { status: row.status }, after: { status: 'EXPIRED', closeReason } },
      });
      return closeReason;
    });
  }
}
