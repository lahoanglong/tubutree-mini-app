import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { describeError } from '../../../config/go-live/secrets';
import { orderStatusLabelVi } from '../../orders/order-transition';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminService } from '../admin.service';
import {
  BULK_ORDER_SELECT,
  BULK_STATUS_ACTION,
  BULK_STATUS_MAX,
  BULK_STATUS_TARGETS,
  bulkStatusBlock,
  uniqueIds,
  type BulkOrder,
  type BulkStatusResult,
  type BulkStatusTarget,
} from './order-bulk-status';

export interface BulkStatusInput {
  orderIds: readonly string[];
  targetStatus: BulkStatusTarget;
  dryRun?: boolean;
  note?: string;
}

export interface BulkStatusResponse {
  dryRun: boolean;
  targetStatus: BulkStatusTarget;
  /** Số mã khác nhau đã xét (sau khi bỏ trùng). total = okCount + skippedCount + failedCount. */
  total: number;
  /** READY (xem trước) hoặc UPDATED (lượt thật). */
  okCount: number;
  /** Đơn đã ở trạng thái đích (từ trước, hoặc thao tác khác vừa đổi trước): bỏ qua, không phải lỗi. */
  skippedCount: number;
  failedCount: number;
  results: BulkStatusResult[];
  /** Dòng `admin_audit_logs` của lượt đổi thật; null khi xem trước hoặc ghi sổ lỗi. */
  auditLogId: string | null;
  /** Đơn đã đổi nhưng ghi sổ lỗi: trả về để người bấm chụp lại làm bằng chứng, không biến cả lượt thành 500. */
  auditError: string | null;
}

function errorText(err: unknown): string {
  if (err instanceof HttpException) {
    const res = err.getResponse();
    const msg = typeof res === 'string' ? res : (res as { message?: unknown }).message;
    if (typeof msg === 'string') return msg.slice(0, 300);
    if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0].slice(0, 300);
  }
  return `Lỗi máy chủ khi đổi đơn này (${describeError(err)}). Mở đơn để xem lại.`;
}

/**
 * Đổi trạng thái tối đa 50 đơn một lượt (`POST /admin/orders/bulk-status`). Mỗi đơn đi riêng qua `AdminService.changeOrderStatus` (cùng đường
 * nút trạng thái trong chi tiết đơn: nhóm việc, bảng chuyển trạng thái, hoàn tồn/điểm/tiền, báo khách), nên một đơn hỏng không chặn các đơn còn
 * lại và mọi đơn đều có kết quả `{ id, ok, outcome, reason }`. Xem trước (`dryRun`) áp cùng luật nhưng không ghi gì. Lượt thật ghi một dòng
 * `admin_audit_logs` kể cả khi có đơn lỗi; đơn lượt này không đổi vì đã ở đích (kể cả do admin khác vừa đổi trước) nằm ở `skipped`, không ở `changed`.
 */
@Injectable()
export class OrderBulkStatusService {
  private readonly logger = new Logger(OrderBulkStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  private async load(ids: readonly string[]): Promise<{ byKey: Map<string, BulkOrder>; onCredit: Set<string> }> {
    const orders = await this.prisma.order.findMany({
      where: { OR: [{ id: { in: [...ids] } }, { code: { in: [...ids] } }] },
      select: BULK_ORDER_SELECT,
    });
    const byKey = new Map<string, BulkOrder>();
    for (const o of orders) {
      byKey.set(o.id, o);
      byKey.set(o.code, o);
    }
    // Đơn đại lý ghi công nợ là BANK_TRANSFER + UNPAID suốt đời mà vẫn giao được (cùng điều kiện danh sách đơn dùng cho allowedTransitions).
    const dealerIds = orders.filter((o) => o.type === 'DEALER').map((o) => o.id);
    const debits = dealerIds.length
      ? await this.prisma.dealerCreditLedger.findMany({ where: { refType: 'ORDER', refId: { in: dealerIds } }, select: { refId: true } })
      : [];
    return { byKey, onCredit: new Set(debits.map((d) => d.refId).filter((id): id is string => !!id)) };
  }

  async run(actor: JwtPayload, input: BulkStatusInput): Promise<BulkStatusResponse> {
    const dryRun = input.dryRun === true;
    const to = input.targetStatus;
    if (!(BULK_STATUS_TARGETS as readonly string[]).includes(to)) {
      throw new BadRequestException('Đổi hàng loạt chỉ nhận «Đã đóng gói» hoặc «Đã huỷ».');
    }
    const ids = uniqueIds(input.orderIds ?? []);
    if (ids.length === 0) throw new BadRequestException('Chọn ít nhất một đơn.');
    if (ids.length > BULK_STATUS_MAX) throw new BadRequestException(`Mỗi lượt tối đa ${BULK_STATUS_MAX} đơn.`);
    const note = input.note?.trim() || undefined;

    const { byKey, onCredit } = await this.load(ids);
    const viewer = { role: actor.role, staffPermissions: actor.staffPermissions };
    const seen = new Set<string>();
    const results: BulkStatusResult[] = [];
    const ready = dryRun ? 'READY' : 'UPDATED';
    for (const id of ids) {
      const order = byKey.get(id);
      if (!order) {
        results.push({ id, code: null, from: null, ok: false, outcome: 'FAILED', reason: 'Không tìm thấy đơn hàng.' });
        continue;
      }
      // Cùng một đơn gửi hai lần (một lần bằng id, một lần bằng mã): chỉ đổi lần đầu.
      if (seen.has(order.id)) {
        results.push({ id, code: order.code, from: order.status, ok: false, outcome: 'FAILED', reason: `Đơn ${order.code} đã có ở dòng trên của lượt này.` });
        continue;
      }
      seen.add(order.id);
      const reason = bulkStatusBlock(viewer, order, to, { onCredit: onCredit.has(order.id) });
      const outcome = order.status === to ? 'SKIPPED' : reason === null ? ready : 'FAILED';
      results.push({ id, code: order.code, from: order.status, ok: reason === null, outcome, reason });
    }

    if (!dryRun) {
      for (const r of results) {
        if (!r.ok) continue;
        const skip = (reason: string) => Object.assign(r, { ok: false, outcome: 'SKIPPED' as const, reason });
        try {
          // Các đơn chạy lần lượt, mỗi đơn huỷ còn hỏi Pancake: đơn cuối có thể đã bị webhook hay người khác đổi từ lúc đọc ở trên.
          // Sang trạng thái khác thì luật đã xét không còn đúng nên không đổi; đã sang đúng đích thì là bỏ qua, không phải lỗi.
          const now = await this.prisma.order.findUnique({ where: { id: byKey.get(r.id)!.id }, select: { status: true } });
          if (now && now.status !== r.from) {
            if (now.status === to) {
              skip(`Đơn ${r.code} vừa được thao tác khác đổi sang «${orderStatusLabelVi(to)}», lượt này không đổi.`);
            } else {
              Object.assign(r, { ok: false, outcome: 'FAILED' as const, reason: `Đơn ${r.code} vừa được đổi sang «${orderStatusLabelVi(now.status)}» bởi thao tác khác, lượt này không đổi.` });
            }
            continue;
          }
          // changeOrderStatus còn đọc lại và kiểm lại luật (đơn đã đẩy sang Đang giao thì không huỷ được). Hai lượt cùng qua bước so ở
          // trên vẫn chỉ một lượt đổi được dòng đơn: lượt thua nhận changed = false (không hoàn tiền/tồn, không báo khách lần hai).
          const { changed } = await this.admin.changeOrderStatus({ ...actor, id: actor.sub }, byKey.get(r.id)!.id, to, note);
          if (!changed) skip(`Đơn ${r.code} vừa được thao tác khác đổi sang «${orderStatusLabelVi(to)}», lượt này không đổi.`);
        } catch (err) {
          Object.assign(r, { ok: false, outcome: 'FAILED' as const, reason: errorText(err) });
        }
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const skippedCount = results.filter((r) => r.outcome === 'SKIPPED').length;
    const base = { dryRun, targetStatus: to, total: results.length, okCount, skippedCount, failedCount: results.length - okCount - skippedCount, results };
    if (dryRun) return { ...base, auditLogId: null, auditError: null };

    let auditLogId: string | null = null;
    let auditError: string | null = null;
    const changed = results.filter((r) => r.outcome === 'UPDATED').map((r) => r.code!);
    const brief = (r: BulkStatusResult) => ({ id: r.id, code: r.code, from: r.from, reason: r.reason });
    try {
      const log = await this.prisma.adminAuditLog.create({
        data: {
          actorId: actor.sub,
          action: BULK_STATUS_ACTION,
          targetType: 'ORDER',
          // Chỉ đơn lượt này đổi thật: đơn bị bỏ qua (đã ở đích, có thể do admin khác vừa đổi) nằm ở payload.skipped.
          targetIds: changed,
          payload: {
            targetStatus: to,
            note: note ?? null,
            actorRole: actor.role,
            staffPermissions: actor.role === 'STAFF' ? [...(actor.staffPermissions ?? [])] : [],
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
      this.logger.error(`Đổi hàng loạt sang ${to} của ${actor.sub} đã chạy nhưng ghi admin_audit_logs lỗi: đổi ${changed.join(', ') || 'không đơn nào'}; ${describeError(err)}`);
    }
    this.logger.warn(`${actor.role} ${actor.sub} đổi hàng loạt sang ${to}: đổi ${okCount}, bỏ qua ${skippedCount}, lỗi ${base.failedCount} / ${results.length} đơn`);
    return { ...base, auditLogId, auditError };
  }
}
