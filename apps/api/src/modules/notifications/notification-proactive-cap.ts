import type { Prisma } from '@prisma/client';
import { vnDateKey } from '../../common/vn-time';
import type { SystemConfigService } from '../system-config/system-config.service';
import { proactivePriority, type ProactiveGroup } from './notification-delivery';

export const PROACTIVE_CAP_ENABLED_KEY = 'notify.proactive_cap_enabled';
export const PROACTIVE_PER_DAY_KEY = 'notify.proactive_per_day';
export const PROACTIVE_PER_WEEK_KEY = 'notify.proactive_per_week';
const DEFAULT_PER_DAY = 1;
const DEFAULT_PER_WEEK = 4;
const WEEK_DAYS = 7;

export interface ProactiveCapLimits {
  perDay: number;
  perWeek: number;
}

/** Dấu trên payload log ZNS của tin chủ động: ngày (giờ VN) tin chiếm lượt và nhóm ưu tiên, để tin ưu tiên hơn giành lại lượt. */
export interface ProactiveMark {
  dayKey: string;
  group: ProactiveGroup;
  /** Mã mẫu của tin đã giành lượt của log này (log bị nhường lượt, đã đóng FAILED). */
  preemptedBy?: string;
}

export type ProactiveSlot =
  | { ok: true; preempted: { id: string; templateCode: string } | null }
  | { ok: false; reason: 'day_cap' | 'week_cap' };

type ReleasePayload = (payload: unknown, logId: string) => Prisma.InputJsonObject | undefined;

const positiveInt = (raw: unknown, fallback: number): number =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : fallback;

/** null khi cờ tắt (mặc định) hoặc không có cấu hình: tin chủ động gửi như trước. */
export async function readProactiveCap(config: SystemConfigService | undefined): Promise<ProactiveCapLimits | null> {
  if (!config) return null;
  if ((await config.get<unknown>(PROACTIVE_CAP_ENABLED_KEY, false)) !== true) return null;
  const [perDay, perWeek] = await Promise.all([
    config.get<unknown>(PROACTIVE_PER_DAY_KEY, DEFAULT_PER_DAY),
    config.get<unknown>(PROACTIVE_PER_WEEK_KEY, DEFAULT_PER_WEEK),
  ]);
  return { perDay: positiveInt(perDay, DEFAULT_PER_DAY), perWeek: positiveInt(perWeek, DEFAULT_PER_WEEK) };
}

/** Ngày tính trần là ngày (giờ VN) tin tới tay khách: tin tạo trong giờ yên tĩnh được dời sang 08:00 nên tính vào ngày hôm sau. */
export function proactiveDayKey(deliverAt: Date): string {
  return vnDateKey(deliverAt);
}

export function proactiveMarkOf(payload: unknown): ProactiveMark | null {
  const mark = (payload as { proactive?: unknown } | null)?.proactive as Partial<ProactiveMark> | undefined;
  return mark && typeof mark.dayKey === 'string' && typeof mark.group === 'string' ? (mark as ProactiveMark) : null;
}

/** Log ZNS đã nhường lượt cho tin ưu tiên hơn: job của nó tới hạn vẫn không được gửi. */
export function isPreemptedZnsLog(payload: unknown): boolean {
  return typeof proactiveMarkOf(payload)?.preemptedBy === 'string';
}

/**
 * Giành một lượt tin chủ động cho khách trong ngày `dayKey`. Gọi trong transaction đang giữ khoá advisory theo khách (`zns-cap:<khách>`),
 * nên hai tin song song không cùng thấy "còn chỗ"; câu UPSERT `count < trần` là chốt chặn thứ hai.
 * - Còn chỗ cả ngày lẫn 7 ngày: tăng bộ đếm.
 * - Hết chỗ: tin nhóm ưu tiên hơn giành lượt của một tin cùng ngày ưu tiên thấp hơn còn PENDING (chưa tới tay khách, vd đang chờ hết giờ
 *   yên tĩnh). Câu UPDATE có điều kiện `status = 'PENDING'` nên tin worker vừa nhận đi gửi thì không bị giành. Bộ đếm giữ nguyên.
 * - Còn lại: bị trần.
 */
export async function claimProactiveSlot(
  tx: Prisma.TransactionClient,
  args: { userId: string; dayKey: string; group: ProactiveGroup; templateCode: string; limits: ProactiveCapLimits; releasedPayload: ReleasePayload },
): Promise<ProactiveSlot> {
  const { userId, dayKey, limits } = args;
  const rows = await tx.$queryRaw<Array<{ day: number; week: number }>>`
    SELECT COALESCE(SUM("count") FILTER (WHERE "dayKey" = ${dayKey}::date), 0)::int AS day,
           COALESCE(SUM("count"), 0)::int AS week
      FROM "notification_proactive_counters"
     WHERE "userId" = ${userId}
       AND "dayKey" > (${dayKey}::date - ${WEEK_DAYS}::int)
       AND "dayKey" <= ${dayKey}::date`;
  const day = rows[0]?.day ?? 0;
  const week = rows[0]?.week ?? 0;
  if (day < limits.perDay && week < limits.perWeek) {
    const bumped = await tx.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "notification_proactive_counters" ("userId", "dayKey", "count")
      VALUES (${userId}, ${dayKey}::date, 1)
      ON CONFLICT ("userId", "dayKey") DO UPDATE SET "count" = "notification_proactive_counters"."count" + 1
       WHERE "notification_proactive_counters"."count" < ${limits.perDay}
      RETURNING "count"`;
    if (bumped.length > 0) return { ok: true, preempted: null };
  }
  const preempted = await preemptLowerPriority(tx, args);
  if (preempted) return { ok: true, preempted };
  return { ok: false, reason: day >= limits.perDay ? 'day_cap' : 'week_cap' };
}

async function preemptLowerPriority(
  tx: Prisma.TransactionClient,
  args: { userId: string; dayKey: string; group: ProactiveGroup; templateCode: string; releasedPayload: ReleasePayload },
): Promise<{ id: string; templateCode: string } | null> {
  const mine = proactivePriority(args.group);
  const pending = await tx.notificationLog.findMany({
    where: { userId: args.userId, channel: 'ZNS', status: 'PENDING', payload: { path: ['proactive', 'dayKey'], equals: args.dayKey } },
    select: { id: true, templateCode: true, payload: true, sentAt: true },
  });
  const candidates = pending
    .map((log) => ({ log, mark: proactiveMarkOf(log.payload) }))
    .filter((c): c is { log: (typeof pending)[number]; mark: ProactiveMark } => !!c.mark && !c.mark.preemptedBy && proactivePriority(c.mark.group) > mine)
    // Nhường lượt tin kém ưu tiên nhất trước; cùng nhóm thì tin tạo sau nhường.
    .sort((a, b) => proactivePriority(b.mark.group) - proactivePriority(a.mark.group) || b.log.sentAt.getTime() - a.log.sentAt.getTime());
  for (const { log, mark } of candidates) {
    const base = (args.releasedPayload(log.payload, log.id) ?? (log.payload as Prisma.InputJsonObject)) as Record<string, unknown>;
    const closed = await tx.notificationLog.updateMany({
      where: { id: log.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        error: `Không gửi ZNS: nhường lượt tin chủ động trong ngày cho tin ưu tiên hơn (${args.templateCode}).`,
        payload: { ...base, proactive: { ...mark, preemptedBy: args.templateCode } } as Prisma.InputJsonObject,
      },
    });
    if (closed.count > 0) return { id: log.id, templateCode: log.templateCode };
  }
  return null;
}
