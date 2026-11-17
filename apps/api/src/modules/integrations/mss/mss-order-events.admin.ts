import { Controller, Get, Injectable, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import type { MssCircuitSnapshot } from './mss-circuit';
import { MssClient } from './mss.client';
import { MssOrderEventFallback } from './mss-order-event.fallback';
import { MssOrderEventRecorder } from './mss-order-event.recorder';
import { maskPhone } from './mss-order-event-types';

const RECENT_ROWS = 50;
const CANCEL_BATCH = 500;
const DAY_MS = 24 * 3_600_000;

export interface MssOrderEventRow {
  eventId: string;
  orderCode: string;
  eventType: string;
  status: string;
  reason: string | null;
  attempts: number;
  phone: string | null;
  fallbackChannel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MssOrderEventsOpsCard {
  enabled: boolean;
  open: boolean;
  rolloutPct: number;
  circuit: MssCircuitSnapshot;
  /** Đang chờ gửi hoặc đang gửi (PENDING + SENDING). */
  waiting: number;
  /** MSS đã nhận, chưa báo kết quả cuối. */
  awaitingResult: number;
  /** 24 giờ qua. */
  sent24h: number;
  failed24h: number;
  fallbackZns24h: number;
  recent: MssOrderEventRow[];
}

/** SĐT trong thân đã lưu, chỉ để che hiển thị; thân hỏng thì không hiện gì. */
function maskedRecipient(body: string): string | null {
  try {
    const phone = (JSON.parse(body) as { recipient?: { phone?: unknown } }).recipient?.phone;
    return typeof phone === 'string' ? maskPhone(phone) : null;
  } catch {
    return null;
  }
}

@Injectable()
export class MssOrderEventsOpsService {
  private readonly logger = new Logger(MssOrderEventsOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recorder: MssOrderEventRecorder,
    private readonly client: MssClient,
    private readonly fallback: MssOrderEventFallback,
  ) {}

  async card(now = Date.now()): Promise<MssOrderEventsOpsCard> {
    const since = new Date(now - DAY_MS);
    const gate = this.recorder.gate(now);
    const [waiting, awaitingResult, sent24h, failed24h, fallbackZns24h, rows] = await Promise.all([
      this.prisma.mssOrderEventOutbox.count({ where: { status: { in: ['PENDING', 'SENDING'] } } }),
      this.prisma.mssOrderEventOutbox.count({ where: { status: 'DELIVERED' } }),
      this.prisma.mssOrderEventOutbox.count({ where: { status: 'RESULT_SENT', updatedAt: { gte: since } } }),
      this.prisma.mssOrderEventOutbox.count({ where: { status: { in: ['DEAD', 'EXPIRED', 'RESULT_FAILED'] }, updatedAt: { gte: since } } }),
      this.prisma.mssOrderEventOutbox.count({ where: { fallbackChannel: 'ZNS', fallbackAt: { gte: since } } }),
      this.prisma.mssOrderEventOutbox.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_ROWS,
        select: { eventId: true, orderCode: true, eventType: true, status: true, resultReason: true, attempts: true, body: true, fallbackChannel: true, createdAt: true, updatedAt: true },
      }),
    ]);
    return {
      enabled: gate.enabled,
      open: gate.open,
      rolloutPct: gate.rolloutPct,
      circuit: this.client.circuit.snapshot(),
      waiting,
      awaitingResult,
      sent24h,
      failed24h,
      fallbackZns24h,
      recent: rows.map((r) => ({
        eventId: r.eventId,
        orderCode: r.orderCode,
        eventType: r.eventType,
        status: r.status,
        reason: r.resultReason,
        attempts: r.attempts,
        phone: maskedRecipient(r.body),
        fallbackChannel: r.fallbackChannel,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Dừng mọi tin chưa gửi (PENDING → CANCELLED) và chạy đường lui cho từng dòng. Dòng đang gửi (SENDING) hay MSS đã nhận thì để nguyên:
   * huỷ ở Tubu không rút được tin khỏi MSS.
   */
  async cancelPending(adminId: string): Promise<{ cancelled: number }> {
    const rows = await this.prisma.mssOrderEventOutbox.findMany({ where: { status: 'PENDING' }, select: { id: true, eventId: true }, take: CANCEL_BATCH });
    let cancelled = 0;
    for (const row of rows) {
      const moved = await this.prisma.mssOrderEventOutbox.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'CANCELLED', resultReason: 'admin_cancelled', resultAt: new Date(), claimedAt: null },
      });
      if (moved.count === 0) continue;
      cancelled++;
      await this.fallback.run(row.eventId);
    }
    this.logger.warn(`Admin ${adminId} huỷ ${cancelled} tin đơn MSS đang chờ.`);
    return { cancelled };
  }
}

@Controller('admin/mss/order-events')
@Roles('ADMIN')
export class MssOrderEventsAdminController {
  constructor(private readonly ops: MssOrderEventsOpsService) {}

  /** Thẻ "Tin đơn hàng qua MSS" ở màn Sức khoẻ hệ thống. Không gọi MSS; SĐT đã che. */
  @Get()
  card() {
    return this.ops.card();
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('cancel-pending')
  cancelPending(@CurrentUser('sub') adminId: string) {
    return this.ops.cancelPending(adminId);
  }
}
