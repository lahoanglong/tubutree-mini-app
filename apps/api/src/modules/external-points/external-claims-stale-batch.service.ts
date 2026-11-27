import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { maskPhoneOrNull } from '../../common/mask-pii';
import { startOfNextVnMonth, startOfVnMonth } from '../../common/vn-time';
import { describeError } from '../../config/go-live/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { DIRECT_APP_DELIVERED_WHERE } from './claim-trust-signals';
import { canonicalUserId } from './external-claim-audit';
import { chatMonthPoints, creatorIsReceiver, creatorMonthPoints, phoneBelongsToStaff, resolveMemberByPhone } from './external-chat.claim';
import { loadChatConfig, loadStaffMap, type ChatConfig } from './external-chat.config';
import { CHAT_SKIP_TEXT, chatCarrierOk, creatorStaffUserId, evaluateChatClaim, PHONE_STALE_REASON } from './external-chat.rules';
import { ExternalClaimsAdminService, type LockedClaim } from './external-claims-admin.service';
import { pancakeCreatorRefs } from './external-order.mapper';
import { maskClaimCode } from './external-points-rate';

/** Trần claim mỗi lượt duyệt nhanh. */
export const STALE_BATCH_MAX = 50;
/** Thành viên phải đã nhận ít nhất ngần này đơn app (đơn Tubu, đã giao) thì SĐT cũ mới được duyệt nhanh. */
export const STALE_BATCH_MIN_DELIVERED = 1;
export { DIRECT_APP_DELIVERED_WHERE };
export const STALE_BATCH_AUDIT_ACTION = 'EXTERNAL_CLAIM_STALE_BATCH_APPROVE';
/** Ghi chú duyệt của mỗi claim (approve bọc thêm dấu "SĐT xác minh cũ:"): lượt kiểm thay cho cuộc gọi xác nhận người nhận. */
export const STALE_BATCH_NOTE = 'Duyệt nhanh: thành viên đã nhận đơn app đã giao, SĐT trên đơn vẫn thuộc tài khoản này, không vướng luật nào khác';

export type StaleBatchOutcome = 'READY' | 'APPROVED' | 'SKIPPED' | 'FAILED';

export interface StaleBatchRow {
  id: string;
  maskedCode: string;
  userName: string | null;
  userPhoneMasked: string | null;
  points: number;
  deliveredAppOrders: number;
  ok: boolean;
  outcome: StaleBatchOutcome;
  /** Vì sao không duyệt nhanh (để duyệt tay từng claim); null khi ok. */
  reason: string | null;
}

export interface StaleBatchResponse {
  dryRun: boolean;
  total: number;
  okCount: number;
  skippedCount: number;
  failedCount: number;
  /** Còn claim chờ vì SĐT cũ ngoài lượt này (danh sách cắt ở STALE_BATCH_MAX). */
  truncated: boolean;
  results: StaleBatchRow[];
  auditLogId: string | null;
  auditError: string | null;
}

const CLAIM_INCLUDE = { externalOrder: true } satisfies Prisma.ExternalPointsClaimInclude;

/** Lời lỗi của một claim trong lượt duyệt nhanh (lời của HttpException, hoặc câu chung kèm mô tả lỗi máy chủ). Dùng chung cho các lượt duyệt nhanh. */
export function batchApproveErrorText(err: unknown): string {
  if (err instanceof HttpException) {
    const res = err.getResponse();
    const msg = typeof res === 'string' ? res : (res as { message?: unknown }).message;
    if (typeof msg === 'string') return msg.slice(0, 300);
    if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0].slice(0, 300);
  }
  return `Lỗi máy chủ khi duyệt claim này (${describeError(err)}).`;
}

interface GuardCtx {
  now: Date;
  cfg: ChatConfig;
  staffMap: ReadonlyMap<string, string>;
}

/**
 * Vì sao claim này KHÔNG được duyệt nhanh (null = được). Lý do REVIEW chỉ lưu lý do đầu tiên của chuỗi luật (`evaluateChatClaim`: SĐT cũ đứng
 * trước nhân viên, người tạo đơn, ngưỡng tiền, hoàn một phần, trần tháng SĐT, trần người tạo), nên "chỉ vướng SĐT cũ" phải chạy lại cả chuỗi với
 * SĐT coi như mới: ra PENDING mới là chỉ vướng SĐT cũ. Thêm hai điều kiện của PO: SĐT trên đơn vẫn trỏ đúng thành viên giữ claim (không đổi chủ,
 * không bị khoá/gộp) và thành viên đã nhận ít nhất một đơn app. Trần tháng xét chặt (không chốt xuống như nút Duyệt).
 */
export async function staleOnlyBlock(db: Prisma.TransactionClient, c: LockedClaim, ctx: GuardCtx): Promise<string | null> {
  if (c.kind !== 'PHONE' || c.state !== 'REVIEW' || c.reviewReason !== PHONE_STALE_REASON) return 'Claim không còn chờ duyệt vì SĐT xác minh đã cũ.';
  if (!c.userId) return 'Claim chưa gắn thành viên.';
  const phone = c.orderPhone ?? c.externalOrder.phone;
  if (!phone) return 'Đơn không còn SĐT để đối chiếu người nhận.';
  const member = await resolveMemberByPhone(db, phone, { now: ctx.now, maxDays: ctx.cfg.phoneVerifiedMaxDays });
  if (!member) return 'SĐT trên đơn không còn gắn một thành viên đủ điều kiện (tài khoản bị khoá, đã gộp hoặc số đã đổi).';
  if (member.id !== (await canonicalUserId(db, c.userId))) return 'SĐT trên đơn nay thuộc một tài khoản khác: duyệt tay.';
  const delivered = await db.order.count({ where: { userId: member.id, ...DIRECT_APP_DELIVERED_WHERE } });
  if (delivered < STALE_BATCH_MIN_DELIVERED) return 'Thành viên chưa nhận đơn app nào: cần gọi xác nhận người nhận rồi duyệt tay.';
  const o = c.externalOrder;
  const lastPayload = (o.lastPayload ?? {}) as Record<string, unknown>;
  const since = startOfVnMonth(c.createdAt);
  const until = startOfNextVnMonth(c.createdAt);
  const [phoneIsStaff, monthPoints, creatorIsMember, creatorPoints] = await Promise.all([
    phoneBelongsToStaff(db, phone),
    chatMonthPoints(db, { phone, userId: member.id, since, until, excludeClaimId: c.id }),
    creatorIsReceiver(db, creatorStaffUserId(pancakeCreatorRefs(lastPayload), ctx.staffMap), member.id, phone),
    c.creatorRef ? creatorMonthPoints(db, { creatorRef: c.creatorRef, since, until, excludeClaimId: c.id }) : Promise.resolve(null),
  ]);
  const decision = evaluateChatClaim({
    now: ctx.now,
    cfg: ctx.cfg,
    order: {
      status: o.status,
      pancakeStatus: o.pancakeStatus,
      hasExtendCode: chatCarrierOk(lastPayload, null),
      hasTrackingCode: o.trackingCode !== null || o.trackingCodes.length > 0,
      goodsValue: o.goodsValue,
      insertedAt: o.pancakeInsertedAt ?? o.firstSeenAt,
      phone,
    },
    member: { ...member, phoneStale: false },
    phoneIsStaff,
    monthPoints,
    creatorIsMember,
    creatorMonthPoints: creatorPoints,
  });
  if (decision.kind === 'SKIP') return `${CHAT_SKIP_TEXT[decision.reason]}: duyệt tay.`;
  if (decision.state !== 'PENDING') return `Còn vướng: ${decision.reviewReason ?? 'luật khác'}.`;
  return null;
}

/**
 * Nút "Duyệt nhanh đơn chat SĐT đã từng nhận app" (PO A3, 22/11/2026): CSKH bấm, máy chủ duyệt từng claim REVIEW chỉ vướng "SĐT xác minh đã
 * cũ". Không tự chạy: không có cron, mỗi lượt do người bấm và ghi `admin_audit_logs`. Xem trước (dryRun) quét tối đa 50 claim cũ nhất; lượt thật
 * nhận đúng danh sách vừa xem và duyệt từng claim qua `ExternalClaimsAdminService.approve` (chặn tự duyệt, người gắn đơn, người tạo đơn Pancake,
 * tính lại điểm), với `staleOnlyBlock` chạy lại dưới khoá SĐT/đơn/claim của chính lượt duyệt.
 */
@Injectable()
export class ExternalClaimsStaleBatchService {
  private readonly logger = new Logger(ExternalClaimsStaleBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly admin: ExternalClaimsAdminService,
  ) {}

  async run(actorId: string, input: { dryRun?: boolean; claimIds?: readonly string[] }, now: Date = new Date()): Promise<StaleBatchResponse> {
    const dryRun = input.dryRun !== false;
    const ids = [...new Set((input.claimIds ?? []).map((s) => s.trim()).filter(Boolean))];
    if (!dryRun && ids.length === 0) throw new BadRequestException('Duyệt nhanh cần danh sách claim đã xem trước.');
    if (ids.length > STALE_BATCH_MAX) throw new BadRequestException(`Mỗi lượt tối đa ${STALE_BATCH_MAX} claim.`);

    const ctx: GuardCtx = { now, cfg: await loadChatConfig(this.config), staffMap: await loadStaffMap(this.config) };
    const found = await this.prisma.externalPointsClaim.findMany({
      where: ids.length > 0 ? { id: { in: ids } } : { kind: 'PHONE', state: 'REVIEW', reviewReason: PHONE_STALE_REASON },
      include: CLAIM_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: STALE_BATCH_MAX + 1,
    });
    const truncated = ids.length === 0 && found.length > STALE_BATCH_MAX;
    const claims = found.slice(0, STALE_BATCH_MAX);
    const byId = new Map(claims.map((c) => [c.id, c]));
    const order = ids.length > 0 ? ids : claims.map((c) => c.id);

    const userIds = [...new Set(claims.map((c) => c.userId).filter((u): u is string => !!u))];
    const [users, delivered] = userIds.length
      ? await Promise.all([
          this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, phone: true } }),
          this.prisma.order.groupBy({ by: ['userId'], where: { userId: { in: userIds }, ...DIRECT_APP_DELIVERED_WHERE }, _count: { _all: true } }),
        ])
      : [[], []];
    const userOf = new Map(users.map((u) => [u.id, u]));
    const deliveredOf = new Map(delivered.map((d) => [d.userId, d._count._all]));
    const actorRoot = await canonicalUserId(this.prisma, actorId);

    const results: StaleBatchRow[] = [];
    for (const id of order) {
      const c = byId.get(id);
      if (!c) {
        results.push({ id, maskedCode: '', userName: null, userPhoneMasked: null, points: 0, deliveredAppOrders: 0, ok: false, outcome: 'FAILED', reason: 'Không tìm thấy claim.' });
        continue;
      }
      const u = c.userId ? userOf.get(c.userId) : undefined;
      const row: StaleBatchRow = {
        id,
        maskedCode: maskClaimCode(c.externalOrder.trackingCode),
        userName: u?.fullName ?? null,
        userPhoneMasked: maskPhoneOrNull(u?.phone),
        points: c.points,
        deliveredAppOrders: c.userId ? (deliveredOf.get(c.userId) ?? 0) : 0,
        ok: false,
        outcome: 'FAILED',
        reason: null,
      };
      results.push(row);
      if (c.state !== 'REVIEW' || c.reviewReason !== PHONE_STALE_REASON) {
        Object.assign(row, { outcome: 'SKIPPED', reason: 'Claim đã được xử lý hoặc không còn chờ vì SĐT cũ.' });
        continue;
      }
      if (c.userId && (c.userId === actorId || (await canonicalUserId(this.prisma, c.userId)) === actorRoot)) {
        row.reason = 'Bạn không được xử lý claim của chính mình.';
        continue;
      }
      const block = await staleOnlyBlock(this.prisma, c, ctx);
      if (block) {
        row.reason = block;
        continue;
      }
      Object.assign(row, { ok: true, outcome: dryRun ? 'READY' : 'APPROVED' });
    }

    if (!dryRun) {
      for (const row of results) {
        if (!row.ok) continue;
        try {
          await this.admin.approve(row.id, actorId, now, STALE_BATCH_NOTE, { guard: (tx, c) => staleOnlyBlock(tx, c, ctx) });
        } catch (err) {
          const text = batchApproveErrorText(err);
          // Người khác vừa duyệt/huỷ claim này: bỏ qua, không phải lỗi của lượt.
          const skipped = /không ở trạng thái chờ duyệt|vừa được xử lý/i.test(text);
          Object.assign(row, { ok: false, outcome: skipped ? 'SKIPPED' : 'FAILED', reason: text });
        }
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const skippedCount = results.filter((r) => r.outcome === 'SKIPPED').length;
    const base = { dryRun, total: results.length, okCount, skippedCount, failedCount: results.length - okCount - skippedCount, truncated, results };
    if (dryRun) return { ...base, auditLogId: null, auditError: null };

    const approved = results.filter((r) => r.outcome === 'APPROVED').map((r) => r.id);
    let auditLogId: string | null = null;
    let auditError: string | null = null;
    try {
      const log = await this.prisma.adminAuditLog.create({
        data: {
          actorId,
          action: STALE_BATCH_AUDIT_ACTION,
          targetType: 'EXTERNAL_POINTS_CLAIM',
          targetIds: approved,
          payload: {
            requested: ids,
            approved,
            note: STALE_BATCH_NOTE,
            minDeliveredAppOrders: STALE_BATCH_MIN_DELIVERED,
            rows: results.map((r) => ({ id: r.id, outcome: r.outcome, points: r.points, deliveredAppOrders: r.deliveredAppOrders, reason: r.reason })),
          },
        },
        select: { id: true },
      });
      auditLogId = log.id;
    } catch (err) {
      auditError = `Chưa ghi được sổ thao tác quản trị (${describeError(err)}).`;
      this.logger.error(`Duyệt nhanh SĐT cũ của ${actorId} đã chạy nhưng ghi admin_audit_logs lỗi: duyệt ${approved.join(', ') || 'không claim nào'}; ${describeError(err)}`);
    }
    this.logger.warn(`${actorId} duyệt nhanh claim SĐT cũ: duyệt ${okCount}, bỏ qua ${skippedCount}, lỗi ${base.failedCount} / ${results.length}`);
    return { ...base, auditLogId, auditError };
  }
}
