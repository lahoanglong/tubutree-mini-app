import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { CRON_TZ } from '../../../common/cron-tz';
import { TrackCron } from '../../../common/cron-run/track-cron';

export interface OpenSessionLike {
  shift: { approvedEnd: Date | null; endAt: Date };
}

/**
 * Quyết định tự đóng phiên: CHỈ khi đã quá giờ hết ca → SHIFT_END (đóng tại giờ hết ca).
 * KHÔNG đóng theo heartbeat cũ (STALE) — NV cất điện thoại vào túi là bình thường, đóng theo
 * heartbeat sẽ cắt nhầm về ~0 giờ công. Quên checkout được xử lý bằng checkout-lùi-giờ + QL sửa.
 * null = chưa đóng.
 */
export function computeAutoClose(
  o: OpenSessionLike,
  now: Date,
): { at: Date; reason: 'SHIFT_END' } | null {
  const effEnd = o.shift.approvedEnd ?? o.shift.endAt;
  if (effEnd.getTime() < now.getTime()) {
    return { at: effEnd, reason: 'SHIFT_END' };
  }
  return null;
}

@Injectable()
export class AttendanceJob {
  private readonly logger = new Logger(AttendanceJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Mỗi 5 phút: đóng phiên đã quá giờ hết ca (chốt tại giờ hết ca). Không cắt theo heartbeat. */
  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: CRON_TZ })
  @TrackCron()
  async sweep(): Promise<{ closed: number }> {
    const now = new Date();
    const open = await this.prisma.attendanceSession.findMany({
      where: { checkoutAt: null },
      include: { shift: { select: { approvedEnd: true, endAt: true } } },
    });
    // Phiên cùng ca có cùng giờ chốt → gom một updateMany. `checkoutAt: null` giữ nguyên checkout nhân viên vừa tự chấm
    // giữa lúc đọc và ghi (update theo id trước đây ghi đè nó); `closed` chỉ đếm phiên thật sự được đóng.
    const groups = new Map<string, { at: Date; reason: 'SHIFT_END'; ids: string[] }>();
    for (const s of open) {
      const decision = computeAutoClose(s, now);
      if (!decision) continue;
      const key = `${decision.at.getTime()}|${decision.reason}`;
      const g = groups.get(key) ?? { ...decision, ids: [] };
      g.ids.push(s.id);
      groups.set(key, g);
    }
    let closed = 0;
    for (const g of groups.values()) {
      const r = await this.prisma.attendanceSession.updateMany({
        where: { id: { in: g.ids }, checkoutAt: null },
        data: { checkoutAt: g.at, closeReason: g.reason },
      });
      closed += r.count;
    }
    if (closed > 0) this.logger.warn(`Auto-checkout ${closed} phiên quá giờ hết ca.`);
    return { closed };
  }
}
