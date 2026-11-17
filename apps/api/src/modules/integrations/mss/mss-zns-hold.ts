import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MssFlagsService } from './mss-flags';
import {
  fallbackDecision,
  MSS_FALLBACK_STATUSES,
  MSS_HOLDING_STATUSES,
  MSS_NO_ZNS_STATUSES,
  MSS_ZNS_TEMPLATE_EVENTS,
  type MssOutboxStatus,
  type MssZnsHoldPort,
} from './mss-order-event-types';

export { MSS_ZNS_HOLD, type MssZnsHoldPort } from './mss-order-event-types';

/** Tin ZNS đã hoãn, cất trong `znsHeldData` để đường lui gửi đúng nội dung lúc hoãn. */
export interface MssHeldZns {
  data: Record<string, string>;
  znsTemplateId: string;
}

export function parseHeldZns(raw: Prisma.JsonValue | null): MssHeldZns | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.znsTemplateId !== 'string' || !o.data || typeof o.data !== 'object' || Array.isArray(o.data)) return null;
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.data as Record<string, unknown>)) if (typeof v === 'string') data[k] = v;
  return { data, znsTemplateId: o.znsTemplateId };
}

const HOLD_SELECT = {
  id: true,
  eventType: true,
  status: true,
  resultReason: true,
  fallbackAt: true,
  fallbackChannel: true,
  znsHeldTemplate: true,
} as const;

/**
 * Luật "một kênh ngoài app" (wave mục 7): mỗi sự kiện đơn khách nhận tin Zalo từ MSS HOẶC ZNS, không bao giờ cả hai. Mọi quyết định đi qua
 * câu UPDATE có điều kiện trên đúng dòng outbox (`fallbackAt IS NULL`), cùng cột mà đường lui nhận phần việc, nên hoãn và đường lui
 * chạy chồng nhau thì chỉ một bên thắng.
 */
@Injectable()
export class MssZnsHoldService implements MssZnsHoldPort {
  private readonly logger = new Logger(MssZnsHoldService.name);

  // Không tiêm MssOrderEventRecorder: recorder → MssHealthService → NotificationsService → luật này thành vòng phụ thuộc.
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: MssFlagsService,
  ) {}

  async holdZns(userId: string, templateCode: string, data: Record<string, string>, znsTemplateId: string): Promise<boolean> {
    const types = MSS_ZNS_TEMPLATE_EVENTS[templateCode];
    const code = data.order_code;
    if (!types || !code || !(await this.flags.isEnabled('orderEvents'))) return false;
    const rows = await this.prisma.mssOrderEventOutbox.findMany({ where: { order: { code, userId }, eventType: { in: [...types] } }, select: HOLD_SELECT });
    const pick = types.map((t) => rows.find((r) => r.eventType === t)).find(Boolean);
    if (!pick) return false;

    let row = pick;
    for (let i = 0; i < 3; i++) {
      const status = row.status as MssOutboxStatus;
      if (MSS_NO_ZNS_STATUSES.includes(status)) return true;
      if (row.fallbackAt) {
        if (row.fallbackChannel === 'ZNS' || fallbackDecision(status, row.resultReason, true) !== 'ZNS') return true;
        // Đường lui đã chạy trước khi tin này tới (chưa có gì để gửi lúc đó): nhận kênh ZNS cho sự kiện, chỉ một lần.
        const upgraded = await this.prisma.mssOrderEventOutbox.updateMany({ where: { id: row.id, fallbackChannel: 'IN_APP_ONLY' }, data: { fallbackChannel: 'ZNS' } });
        if (upgraded.count === 1) {
          this.logger.log(`mss_order_event_fallback zns_late template=${templateCode} order=${code}`);
          return false;
        }
      } else if (MSS_FALLBACK_STATUSES.includes(status)) {
        const decision = fallbackDecision(status, row.resultReason, true);
        const claimed = await this.prisma.mssOrderEventOutbox.updateMany({
          where: { id: row.id, status, fallbackAt: null },
          data: { fallbackAt: new Date(), fallbackChannel: decision === 'ZNS' ? 'ZNS' : 'IN_APP_ONLY' },
        });
        if (claimed.count === 1) {
          this.logger.log(`mss_order_event_fallback ${decision} template=${templateCode} order=${code}`);
          return decision !== 'ZNS';
        }
      } else if (MSS_HOLDING_STATUSES.includes(status)) {
        if (row.znsHeldTemplate) return true;
        const held: MssHeldZns = { data, znsTemplateId };
        const stored = await this.prisma.mssOrderEventOutbox.updateMany({
          where: { id: row.id, status: { in: [...MSS_HOLDING_STATUSES] }, fallbackAt: null, znsHeldTemplate: null },
          data: { znsHeldTemplate: templateCode, znsHeldData: held as unknown as Prisma.InputJsonObject, znsHeldAt: new Date() },
        });
        if (stored.count === 1) return true;
      }
      const fresh = await this.prisma.mssOrderEventOutbox.findUnique({ where: { id: row.id }, select: HOLD_SELECT });
      if (!fresh) return false;
      row = fresh;
    }
    // Ba lượt đều thua đua với worker/đường lui: không gửi ZNS (tin trong app đã lưu), tránh gửi đôi với MSS.
    this.logger.warn(`Bỏ ZNS ${templateCode} đơn ${code}: dòng outbox đổi liên tục, không chốt được kênh.`);
    return true;
  }
}
