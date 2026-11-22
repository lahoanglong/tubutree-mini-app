import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import type { Prisma, WasteActorRole } from '@prisma/client';
import { assertActiveAdmin } from '../../../common/staff-access';
import { describeError } from '../../../config/go-live/secrets';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WASTE_UNMATCHED_OPEN_WHERE } from '../core/waste-queue-filters';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { lockWasteCustomer } from '../waste-locks';
import {
  BULK_TEXT,
  WASTE_BULK_ACTIONS,
  WASTE_BULK_AUDIT_ACTION,
  WASTE_BULK_MAX,
  closeLostDecision,
  receiveDecision,
  uniqueRequestIds,
  type WasteBulkAction,
  type WasteBulkDecision,
  type WasteBulkResult,
  type WasteBulkRow,
} from './waste-bulk-action';
import { evaluateMatch } from './waste-match';

export interface WasteBulkInput {
  action: WasteBulkAction;
  requestIds: readonly string[];
  dryRun?: boolean;
  /** Nhận kiện gửi kho/lấy tận nhà: người bấm đã đối chiếu SĐT người gửi và mã vận đơn trên từng kiện. */
  phoneMatchConfirmed?: boolean;
  /** Đóng thất lạc: lý do ghi vào sự kiện từng yêu cầu (nội bộ, khách nhận câu báo chuẩn). */
  reason?: string;
}

export interface WasteBulkResponse {
  dryRun: boolean;
  action: WasteBulkAction;
  /** total = okCount + skippedCount + failedCount. */
  total: number;
  okCount: number;
  skippedCount: number;
  failedCount: number;
  results: WasteBulkResult[];
  auditLogId: string | null;
  auditError: string | null;
}

const BULK_SELECT = {
  id: true,
  code: true,
  userId: true,
  method: true,
  status: true,
  pointId: true,
  orderId: true,
  trackingNorm: true,
  trackingConflict: true,
  inTransitAt: true,
  closeReason: true,
  order: { select: { status: true } },
  user: { select: { isBlocked: true, wasteFlags: { select: { blockedAt: true } } } },
} satisfies Prisma.WasteRequestSelect;

type Loaded = Prisma.WasteRequestGetPayload<{ select: typeof BULK_SELECT }>;

const rowOf = (r: Loaded): WasteBulkRow => ({
  code: r.code,
  method: r.method,
  status: r.status,
  orderId: r.orderId,
  orderStatus: r.order?.status ?? null,
  trackingNorm: r.trackingNorm,
  trackingConflict: r.trackingConflict,
  inTransitAt: r.inTransitAt,
  closeReason: r.closeReason,
  customerBlocked: r.user.isBlocked || !!r.user.wasteFlags?.blockedAt,
});

function errorText(err: unknown): string {
  if (err instanceof HttpException) {
    const res = err.getResponse();
    const msg = typeof res === 'string' ? res : (res as { message?: unknown }).message;
    if (typeof msg === 'string') return msg.slice(0, 300);
    if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0].slice(0, 300);
  }
  return `Lỗi máy chủ khi xử lý yêu cầu này (${describeError(err)}). Mở chi tiết để xem lại.`;
}

/**
 * Kiện "hàng không rõ chủ" còn mở có thể chính là kiện của yêu cầu: kiện gắn yêu cầu (nút Nhận kiện ghi lại khi không đối chiếu được) hoặc kiện cùng
 * mã vận đơn đã chuẩn hoá (nhân viên nhập tay từ nhãn kiện). Còn kiện như vậy thì đóng thất lạc sẽ báo khách "thất lạc" trong khi kiện đang ở kho.
 */
export function openParcelForRequestWhere(r: { id: string; trackingNorm: string | null }): Prisma.WasteUnmatchedParcelWhereInput {
  return { ...WASTE_UNMATCHED_OPEN_WHERE, OR: [{ relatedRequestId: r.id }, ...(r.trackingNorm ? [{ trackingNorm: r.trackingNorm }] : [])] };
}

/** Ném trong transaction để rollback và mang kết quả SKIP/FAIL ra ngoài mà không đổi gì. */
class RowStop extends Error {
  constructor(readonly decision: Exclude<WasteBulkDecision, { kind: 'OK' }>) {
    super(decision.reason);
  }
}

/**
 * Thao tác hàng loạt ở bảng Đổi rác (`POST /admin/waste/requests/bulk-action`): nhận kiện (kho) hoặc đóng thất lạc (chỉ ADMIN, hàng gửi kho quá
 * hạn). Xem trước (`dryRun`) áp cùng luật nhưng không ghi gì. Lượt thật đi từng yêu cầu trong transaction riêng: khoá khách
 * (`lockWasteCustomer`, cùng thứ tự với mở lại và sửa yêu cầu) rồi `FOR UPDATE` dòng yêu cầu, xét lại luật trên bản vừa khoá, đổi có điều kiện,
 * ghi `waste_events`; một yêu cầu hỏng không chặn yêu cầu khác. Mỗi lượt thật ghi một dòng `admin_audit_logs`.
 */
@Injectable()
export class WasteBulkActionService {
  private readonly logger = new Logger(WasteBulkActionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WasteAccessService,
    private readonly config: WasteConfigService,
    private readonly notifier: WasteNotifierService,
  ) {}

  async run(callerUserId: string, input: WasteBulkInput): Promise<WasteBulkResponse> {
    const action = input.action;
    if (!(WASTE_BULK_ACTIONS as readonly string[]).includes(action)) throw new BadRequestException('Thao tác hàng loạt chỉ nhận «Nhận kiện» hoặc «Đóng vì thất lạc».');
    const ids = uniqueRequestIds(input.requestIds ?? []);
    if (ids.length === 0) throw new BadRequestException('Chọn ít nhất một yêu cầu.');
    if (ids.length > WASTE_BULK_MAX) throw new BadRequestException(`Mỗi lượt tối đa ${WASTE_BULK_MAX} yêu cầu.`);
    const dryRun = input.dryRun === true;
    const reason = input.reason?.trim() ?? '';
    if (action === 'CLOSE_LOST' && !dryRun && reason === '') throw new BadRequestException('Cần lý do đóng vì thất lạc.');
    const phoneMatchConfirmed = input.phoneMatchConfirmed === true;

    // Cùng quyền nút từng yêu cầu: nhận kiện cho nhân viên kho và admin, đóng thất lạc chỉ admin.
    const staff = action === 'CLOSE_LOST' ? await assertActiveAdmin(this.prisma, callerUserId) : await this.access.assertWarehouseActor(callerUserId);
    const reviewDays = action === 'CLOSE_LOST' ? (await this.config.snapshot()).inTransitReviewDays : 0;
    const now = new Date();

    const found = await this.prisma.wasteRequest.findMany({ where: { OR: [{ id: { in: ids } }, { code: { in: ids } }] }, select: BULK_SELECT });
    const byKey = new Map<string, Loaded>();
    for (const r of found) {
      byKey.set(r.id, r);
      byKey.set(r.code, r);
    }

    const decide = async (db: Prisma.TransactionClient, r: Loaded, asDry: boolean): Promise<WasteBulkDecision> => {
      if (action === 'CLOSE_LOST') {
        const d = closeLostDecision(rowOf(r), { now, reviewDays });
        if (d.kind !== 'OK') return d;
        const parcel = await db.wasteUnmatchedParcel.findFirst({ where: openParcelForRequestWhere(r), select: { id: true } });
        return parcel ? { kind: 'FAIL', reason: BULK_TEXT.OPEN_UNMATCHED_PARCEL } : d;
      }
      const d = receiveDecision(rowOf(r), { phoneMatchConfirmed, dryRun: asDry });
      if (d.kind !== 'OK') return d;
      // Cùng hàm đối chiếu của nút Nhận kiện từng kiện: túi kèm đơn khớp theo đơn, kiện gửi kho khớp theo mã vận đơn duy nhất.
      const m = await evaluateMatch(db, r, { phoneMatchConfirmed: true });
      if (m.ok) return d;
      return { kind: 'FAIL', reason: m.reason === 'TRACKING_MULTI' ? BULK_TEXT.TRACKING_MULTI : BULK_TEXT.NO_TRACKING };
    };

    const seen = new Set<string>();
    const results: WasteBulkResult[] = [];
    const loaded = new Map<WasteBulkResult, Loaded>();
    for (const id of ids) {
      const r = byKey.get(id);
      const base = { id, code: r?.code ?? null, method: r?.method ?? null, from: r?.status ?? null, needsPhoneConfirm: false };
      if (!r) {
        results.push({ ...base, ok: false, outcome: 'FAILED', reason: BULK_TEXT.NOT_FOUND });
        continue;
      }
      if (seen.has(r.id)) {
        results.push({ ...base, ok: false, outcome: 'FAILED', reason: BULK_TEXT.DUPLICATE });
        continue;
      }
      seen.add(r.id);
      const d = await decide(this.prisma, r, dryRun);
      const res: WasteBulkResult =
        d.kind === 'OK'
          ? { ...base, ok: true, outcome: dryRun ? 'READY' : 'UPDATED', reason: null, needsPhoneConfirm: d.needsPhoneConfirm }
          : { ...base, ok: false, outcome: d.kind === 'SKIP' ? 'SKIPPED' : 'FAILED', reason: d.reason };
      results.push(res);
      loaded.set(res, r);
    }

    if (!dryRun) {
      for (const res of results) {
        if (!res.ok) continue;
        const pre = loaded.get(res)!;
        try {
          const done = await this.applyOne(callerUserId, staff.role, pre, action, reason, phoneMatchConfirmed, now, decide);
          await this.notifyAfter(pre, action, done.eventId, now);
        } catch (err) {
          if (err instanceof RowStop) {
            Object.assign(res, { ok: false, outcome: err.decision.kind === 'SKIP' ? 'SKIPPED' : 'FAILED', reason: err.decision.reason });
          } else {
            Object.assign(res, { ok: false, outcome: 'FAILED', reason: errorText(err) });
          }
        }
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const skippedCount = results.filter((r) => r.outcome === 'SKIPPED').length;
    const base = { dryRun, action, total: results.length, okCount, skippedCount, failedCount: results.length - okCount - skippedCount, results };
    if (dryRun) return { ...base, auditLogId: null, auditError: null };

    const changed = results.filter((r) => r.outcome === 'UPDATED').map((r) => r.code!);
    const brief = (r: WasteBulkResult) => ({ id: r.id, code: r.code, from: r.from, reason: r.reason });
    let auditLogId: string | null = null;
    let auditError: string | null = null;
    try {
      const log = await this.prisma.adminAuditLog.create({
        data: {
          actorId: callerUserId,
          action: WASTE_BULK_AUDIT_ACTION,
          targetType: 'WASTE_REQUEST',
          targetIds: changed,
          payload: {
            action,
            reason: action === 'CLOSE_LOST' ? reason : null,
            phoneMatchConfirmed: action === 'MARK_RECEIVED' ? phoneMatchConfirmed : null,
            actorRole: staff.role,
            requested: ids,
            changed,
            skipped: results.filter((r) => r.outcome === 'SKIPPED').map(brief),
            failed: results.filter((r) => r.outcome === 'FAILED').map(brief),
          },
        },
        select: { id: true },
      });
      auditLogId = log.id;
    } catch (err) {
      auditError = `Chưa ghi được sổ thao tác quản trị (${describeError(err)}).`;
      this.logger.error(`Đổi rác hàng loạt ${action} của ${callerUserId} đã chạy nhưng ghi admin_audit_logs lỗi: đổi ${changed.join(', ') || 'không yêu cầu nào'}; ${describeError(err)}`);
    }
    this.logger.warn(`${staff.role} ${callerUserId} đổi rác hàng loạt ${action}: đổi ${okCount}, bỏ qua ${skippedCount}, lỗi ${base.failedCount} / ${results.length}`);
    return { ...base, auditLogId, auditError };
  }

  private async applyOne(
    caller: string,
    actorRole: WasteActorRole,
    pre: Loaded,
    action: WasteBulkAction,
    reason: string,
    phoneMatchConfirmed: boolean,
    now: Date,
    decide: (db: Prisma.TransactionClient, r: Loaded, asDry: boolean) => Promise<WasteBulkDecision>,
  ): Promise<{ eventId: string }> {
    return this.prisma.$transaction(async (tx) => {
      await lockWasteCustomer(tx, pre.userId);
      await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${pre.id} FOR UPDATE`;
      const r = await tx.wasteRequest.findUnique({ where: { id: pre.id }, select: BULK_SELECT });
      // Gộp tài khoản chuyển yêu cầu sang khách khác sau lần đọc không khoá: khoá khách đang giữ không còn đúng.
      if (!r || r.userId !== pre.userId) throw new RowStop({ kind: 'FAIL', reason: BULK_TEXT.RETRY });
      if (action === 'MARK_RECEIVED') await this.access.assertWarehouseActor(caller, tx);
      const d = await decide(tx, r, false);
      if (d.kind !== 'OK') throw new RowStop(d);

      if (action === 'MARK_RECEIVED') {
        const upd = await tx.wasteRequest.updateMany({
          where: { id: r.id, method: r.method, status: { in: ['OPEN', 'IN_TRANSIT'] }, ...(r.method === 'PICKUP' ? { orderId: r.orderId } : {}) },
          data: { status: 'RECEIVED', receivedAt: now },
        });
        if (upd.count !== 1) throw new RowStop({ kind: 'FAIL', reason: BULK_TEXT.RETRY });
        const ev = await writeWasteEvent(tx, {
          kind: 'PARCEL_RECEIVED',
          actorUserId: caller,
          actorRole,
          requestId: r.id,
          pointId: r.pointId,
          meta: {
            matchBasis: r.method === 'PICKUP' ? 'ORDER' : 'TRACKING_PHONE',
            phoneMatchConfirmed: r.method === 'PICKUP' ? false : phoneMatchConfirmed,
            parcelTrackingNorm: null,
            trackingMismatch: null,
            bulk: true,
            subjectUserId: r.userId,
            before: { status: r.status },
            after: { status: 'RECEIVED' },
          },
        });
        return { eventId: ev.id };
      }

      const upd = await tx.wasteRequest.updateMany({
        where: { id: r.id, method: r.method, status: 'IN_TRANSIT' },
        data: { status: 'EXPIRED', closedAt: now, closeReason: 'LOST' },
      });
      if (upd.count !== 1) throw new RowStop({ kind: 'FAIL', reason: BULK_TEXT.RETRY });
      const ev = await writeWasteEvent(tx, {
        kind: 'REQUEST_CLOSED_LOST',
        actorUserId: caller,
        actorRole: 'ADMIN',
        requestId: r.id,
        pointId: r.pointId,
        meta: {
          reason,
          closeReason: 'LOST',
          bulk: true,
          subjectUserId: r.userId,
          before: { status: r.status },
          after: { status: 'EXPIRED', closeReason: 'LOST' },
        },
      });
      return { eventId: ev.id };
    });
  }

  /** Báo khách sau khi transaction đã commit; lỗi gửi tin không đảo thao tác đã ghi. */
  private async notifyAfter(r: Loaded, action: WasteBulkAction, eventId: string, now: Date): Promise<void> {
    try {
      if (action === 'MARK_RECEIVED') await this.notifier.parcelReceived(r.userId, { id: r.id, code: r.code }, eventId);
      else await this.notifier.requestExpired(r.userId, { id: r.id, code: r.code, method: r.method }, 'LOST', now);
    } catch (e) {
      this.logger.warn(`Không gửi được tin ${action} của ${r.code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
