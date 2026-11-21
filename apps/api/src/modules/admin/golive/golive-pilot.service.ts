import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { describeError } from '../../../config/go-live/secrets';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminService } from '../admin.service';
import {
  PILOT_CANCEL_NOTE,
  PILOT_CLEANUP_ACTION,
  PILOT_CLEANUP_MAX,
  PILOT_CONFIRM_TEXT,
  PILOT_LIST_MAX,
  PILOT_NOTE_MARKER,
  PILOT_ORDER_SELECT,
  PILOT_PHONES_MAX,
  PILOT_WINDOW_DAYS,
  maskPhone,
  parseTestPhone,
  pilotCandidateWhere,
  pilotMatches,
  planFor,
  toPilotRow,
  type PilotAction,
  type PilotOrderRow,
} from './golive-pilot';

export interface PilotOrdersView {
  marker: string;
  confirmText: string;
  windowDays: number;
  /** Danh sách bị cắt ở PILOT_LIST_MAX dòng. */
  truncated: boolean;
  orders: PilotOrderRow[];
  counts: Record<PilotAction, number>;
}

export interface PilotCleanupInput {
  dryRun?: boolean;
  confirmText?: string;
  codes?: string[];
  phones?: string[];
}

export interface PilotCleanupResult {
  dryRun: boolean;
  /** Dòng của đúng các mã được xét, với việc sẽ làm (dryRun) hoặc đã định làm. */
  orders: PilotOrderRow[];
  /** Bản ghi sẽ đổi (dryRun) hoặc đã đổi: đơn huỷ (mỗi đơn một dòng orders + một dòng order_status_history), một dòng admin_audit_logs. */
  affected: { ordersCancelled: number; statusHistoryRows: number; ordersArchived: number; auditLogRows: number };
  cancelled: string[];
  archived: string[];
  skipped: { code: string; reason: string }[];
  failed: { code: string; message: string }[];
  auditLogId: string | null;
  /** Đơn đã huỷ nhưng ghi sổ admin_audit_logs lỗi: báo để quản trị viên chụp kết quả này làm bằng chứng. */
  auditError: string | null;
}

function counts(rows: readonly PilotOrderRow[]): Record<PilotAction, number> {
  const out: Record<PilotAction, number> = { CANCEL: 0, ARCHIVE: 0, MANUAL: 0, DONE: 0 };
  for (const r of rows) out[r.action] += 1;
  return out;
}

function errorText(err: unknown): string {
  if (err instanceof HttpException) {
    const res = err.getResponse();
    const msg = typeof res === 'string' ? res : (res as { message?: unknown }).message;
    if (typeof msg === 'string') return msg.slice(0, 300);
    if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0].slice(0, 300);
  }
  return `lỗi máy chủ (${describeError(err)})`;
}

/** SĐT người thử: bỏ trùng, sai dạng thì 400 (không tự sửa để không khớp nhầm đơn của khách khác). */
export function parseTestPhones(raw: readonly string[] | undefined): string[] {
  const list = (raw ?? []).map((s) => s.trim()).filter(Boolean);
  if (list.length > PILOT_PHONES_MAX) throw new BadRequestException(`Tối đa ${PILOT_PHONES_MAX} SĐT người thử.`);
  const out = new Set<string>();
  for (const s of list) {
    const p = parseTestPhone(s);
    if (!p) throw new BadRequestException(`SĐT người thử "${s}" không đúng dạng 0xxxxxxxxx.`);
    out.add(p);
  }
  return [...out];
}

/**
 * Bàn dọn đơn thử sau Giờ G. Xem trước (dryRun, mặc định) không ghi gì. Dọn thật cần gõ đúng `XOA DON THU` và danh sách mã đã xem; mã nào
 * không còn là đơn thử (không có `[PILOT]`, không khớp SĐT người thử) thì từ chối cả lượt, không đơn nào bị đụng. Huỷ đi qua
 * `AdminService.updateOrderStatus` (cùng đường nút Huỷ, cùng bảng chuyển trạng thái và hệ quả hoàn tồn/điểm). Mỗi lượt dọn thật ghi một dòng
 * `admin_audit_logs` (cả khi một số đơn lỗi).
 */
@Injectable()
export class GoLivePilotService {
  private readonly logger = new Logger(GoLivePilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  private async rows(phones: readonly string[], now: Date): Promise<{ rows: PilotOrderRow[]; truncated: boolean }> {
    const found = await this.prisma.order.findMany({
      where: pilotCandidateWhere(phones, now),
      orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
      take: PILOT_LIST_MAX + 1,
      select: PILOT_ORDER_SELECT,
    });
    const phoneSet = new Set(phones);
    const matched = found.slice(0, PILOT_LIST_MAX).flatMap((o) => {
      const by = pilotMatches(o, phoneSet);
      return by.length > 0 ? [{ o, by }] : [];
    });
    const codes = matched.map((m) => m.o.code);
    const done = new Set<string>();
    if (codes.length > 0) {
      const logs = await this.prisma.adminAuditLog.findMany({
        where: { action: PILOT_CLEANUP_ACTION, targetIds: { hasSome: codes } },
        select: { targetIds: true },
      });
      for (const l of logs) for (const c of l.targetIds) done.add(c);
    }
    return { rows: matched.map(({ o, by }) => toPilotRow(o, by, done.has(o.code))), truncated: found.length > PILOT_LIST_MAX };
  }

  async list(rawPhones: readonly string[] | undefined, now: Date = new Date()): Promise<PilotOrdersView> {
    const { rows, truncated } = await this.rows(parseTestPhones(rawPhones), now);
    return { marker: PILOT_NOTE_MARKER, confirmText: PILOT_CONFIRM_TEXT, windowDays: PILOT_WINDOW_DAYS, truncated, orders: rows, counts: counts(rows) };
  }

  async cleanup(actor: JwtPayload, input: PilotCleanupInput, now: Date = new Date()): Promise<PilotCleanupResult> {
    const dryRun = input.dryRun !== false;
    if (!dryRun && input.confirmText?.trim() !== PILOT_CONFIRM_TEXT) {
      throw new BadRequestException(`Dọn thật cần gõ đúng "${PILOT_CONFIRM_TEXT}" vào ô xác nhận.`);
    }
    const requested = [...new Set((input.codes ?? []).map((c) => c.trim()).filter(Boolean))];
    if (!dryRun && requested.length === 0) throw new BadRequestException('Dọn thật cần danh sách mã đơn đã xem trước.');
    if (requested.length > PILOT_CLEANUP_MAX) throw new BadRequestException(`Mỗi lượt dọn tối đa ${PILOT_CLEANUP_MAX} đơn.`);
    const phones = parseTestPhones(input.phones);

    const { rows } = await this.rows(phones, now);
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const refused = requested.filter((c) => !byCode.has(c));
    if (refused.length > 0) {
      throw new BadRequestException(
        `Không phải đơn thử (không có ${PILOT_NOTE_MARKER} trong ghi chú, không khớp SĐT người thử, hoặc đặt quá ${PILOT_WINDOW_DAYS} ngày): ${refused.join(', ')}. Không đơn nào bị đụng.`,
      );
    }
    const target = requested.length > 0 ? requested.map((c) => byCode.get(c)!) : rows.filter((r) => r.action === 'CANCEL' || r.action === 'ARCHIVE');

    const toCancel = target.filter((r) => r.action === 'CANCEL');
    const archived = target.filter((r) => r.action === 'ARCHIVE').map((r) => r.code);
    const skipped = target.filter((r) => r.action === 'MANUAL' || r.action === 'DONE').map((r) => ({ code: r.code, reason: r.reason }));

    if (dryRun) {
      return {
        dryRun,
        orders: target,
        affected: { ordersCancelled: toCancel.length, statusHistoryRows: toCancel.length, ordersArchived: archived.length, auditLogRows: 1 },
        cancelled: toCancel.map((r) => r.code),
        archived,
        skipped,
        failed: [],
        auditLogId: null,
        auditError: null,
      };
    }

    const phoneSet = new Set(phones);
    const cancelled: string[] = [];
    const failed: { code: string; message: string }[] = [];
    for (const r of toCancel) {
      try {
        // Đọc lại ngay trước khi huỷ: giữa lúc xem trước và lúc dọn, đơn có thể đã được trả tiền (webhook ngân hàng) hoặc đã đóng gói.
        const fresh = await this.prisma.order.findUnique({ where: { code: r.code }, select: PILOT_ORDER_SELECT });
        const by = fresh ? pilotMatches(fresh, phoneSet) : [];
        const plan = fresh && by.length > 0 ? planFor(fresh, by, false) : null;
        if (!plan || plan.action !== 'CANCEL') {
          skipped.push({ code: r.code, reason: plan ? `Đơn đổi giữa lúc xem trước và lúc dọn. ${plan.reason}` : 'Không còn là đơn thử.' });
          continue;
        }
        await this.admin.updateOrderStatus({ ...actor, id: actor.sub }, r.code, 'CANCELLED', PILOT_CANCEL_NOTE);
        cancelled.push(r.code);
      } catch (err) {
        failed.push({ code: r.code, message: errorText(err) });
      }
    }

    let auditLogId: string | null = null;
    let auditError: string | null = null;
    try {
      const log = await this.prisma.adminAuditLog.create({
        data: {
          actorId: actor.sub,
          action: PILOT_CLEANUP_ACTION,
          targetType: 'ORDER',
          targetIds: [...cancelled, ...archived],
          payload: {
            requested,
            cancelled,
            archived,
            skipped,
            failed,
            phones: phones.map((p) => maskPhone(p)),
            matchedBy: Object.fromEntries(target.map((r) => [r.code, r.matchedBy])),
          },
        },
        select: { id: true },
      });
      auditLogId = log.id;
    } catch (err) {
      auditError = `Chưa ghi được sổ thao tác quản trị (${describeError(err)}).`;
      this.logger.error(`Dọn đơn thử của admin ${actor.sub} đã chạy nhưng ghi admin_audit_logs lỗi: huỷ ${cancelled.join(', ') || 'không đơn nào'}; ${describeError(err)}`);
    }
    this.logger.warn(`Admin ${actor.sub} dọn đơn thử: huỷ ${cancelled.length}, ghi sổ ${archived.length}, bỏ qua ${skipped.length}, lỗi ${failed.length}`);
    return {
      dryRun,
      orders: target,
      affected: { ordersCancelled: cancelled.length, statusHistoryRows: cancelled.length, ordersArchived: archived.length, auditLogRows: 1 },
      cancelled,
      archived,
      skipped,
      failed,
      auditLogId,
      auditError,
    };
  }
}
