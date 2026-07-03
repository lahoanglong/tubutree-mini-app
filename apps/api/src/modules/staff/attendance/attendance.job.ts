import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';

export interface OpenSessionLike {
  lastHeartbeatAt: Date;
  shift: { approvedEnd: Date | null; endAt: Date };
}

/**
 * Quyết định tự đóng phiên: heartbeat cũ quá ngưỡng → STALE (đóng tại heartbeat cuối);
 * hoặc đã quá giờ hết ca → SHIFT_END (đóng tại min(now, giờ hết ca)). null = chưa đóng.
 */
export function computeAutoClose(
  o: OpenSessionLike,
  now: Date,
  staleMin: number,
): { at: Date; reason: 'STALE' | 'SHIFT_END' } | null {
  const staleCut = now.getTime() - staleMin * 60000;
  if (o.lastHeartbeatAt.getTime() < staleCut) {
    return { at: o.lastHeartbeatAt, reason: 'STALE' };
  }
  const effEnd = o.shift.approvedEnd ?? o.shift.endAt;
  if (effEnd.getTime() < now.getTime()) {
    return { at: new Date(Math.min(now.getTime(), effEnd.getTime())), reason: 'SHIFT_END' };
  }
  return null;
}

@Injectable()
export class AttendanceJob {
  private readonly logger = new Logger(AttendanceJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /** Mỗi 5 phút: đóng phiên bỏ quên (mất heartbeat) hoặc đã quá giờ hết ca. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<{ closed: number }> {
    const staleMin = await this.config.get<number>('attendance.heartbeat_stale_min', 10);
    const now = new Date();
    const open = await this.prisma.attendanceSession.findMany({
      where: { checkoutAt: null },
      include: { shift: { select: { approvedEnd: true, endAt: true } } },
    });
    let closed = 0;
    for (const s of open) {
      const decision = computeAutoClose(s, now, staleMin);
      if (!decision) continue;
      await this.prisma.attendanceSession.update({
        where: { id: s.id },
        data: { checkoutAt: decision.at, closeReason: decision.reason },
      });
      closed++;
    }
    if (closed > 0) this.logger.warn(`Auto-checkout ${closed} phiên bỏ quên/hết ca.`);
    return { closed };
  }
}
