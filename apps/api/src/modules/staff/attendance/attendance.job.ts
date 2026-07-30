import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PrismaService } from '../../../prisma/prisma.service';

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
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<{ closed: number }> {
    const now = new Date();
    const open = await this.prisma.attendanceSession.findMany({
      where: { checkoutAt: null },
      include: { shift: { select: { approvedEnd: true, endAt: true } } },
    });
    let closed = 0;
    for (const s of open) {
      const decision = computeAutoClose(s, now);
      if (!decision) continue;
      await this.prisma.attendanceSession.update({
        where: { id: s.id },
        data: { checkoutAt: decision.at, closeReason: decision.reason },
      });
      closed++;
    }
    if (closed > 0) this.logger.warn(`Auto-checkout ${closed} phiên quá giờ hết ca.`);
    return { closed };
  }
}
