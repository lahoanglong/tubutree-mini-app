import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AdminRecipientNameMatch } from '@tubutree/shared-types';
import { maskPhoneOrNull } from '../../common/mask-pii';
import { isRealUser } from '../../common/real-user';
import { startOfNextVnMonth, startOfVnMonth } from '../../common/vn-time';
import { describeError } from '../../config/go-live/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { DIRECT_APP_DELIVERED_WHERE, RECIPIENT_PAYLOAD_KEY, recipientNameMatch, STANDING_CREDITED_SCAN_WHERE } from './claim-trust-signals';
import { canonicalUserId } from './external-claim-audit';
import { loadClaimConfig, type ClaimConfig } from './external-claim.config';
import { NO_PHONE_REVIEW_REASON } from './external-claim.rules';
import { ExternalClaimsAdminService, type LockedClaim } from './external-claims-admin.service';
import { batchApproveErrorText, type StaleBatchOutcome } from './external-claims-stale-batch.service';
import { claimPoints, maskClaimCode } from './external-points-rate';
import { orderPhoneMatch } from './order-phone-match';

/** Trần claim mỗi lượt duyệt nhanh. */
export const NO_PHONE_BATCH_MAX = 50;
/** Nút chỉ nhận đơn Lazada (sàn che SĐT `***`): Shopee/TikTok thiếu SĐT vẫn duyệt tay từng claim. */
export const NO_PHONE_BATCH_CHANNEL = 'lazada';
export const NO_PHONE_BATCH_AUDIT_ACTION = 'EXTERNAL_CLAIM_NO_PHONE_BATCH_APPROVE';
/** Dấu của lượt trong nhật ký APPROVE từng claim (approve ghi kèm), và ghi chú của sổ thao tác quản trị. */
export const NO_PHONE_BATCH_NOTE = 'Duyệt nhanh đơn Lazada thiếu SĐT: thành viên đã xác minh SĐT và là khách quen, không vướng luật nào khác';

export interface NoPhoneBatchRow {
  id: string;
  maskedCode: string;
  userName: string | null;
  userPhoneMasked: string | null;
  points: number;
  /** Đơn app chính thành viên đặt, đã giao (không tính đơn đại lý, đơn CTV đặt hộ). */
  deliveredAppOrders: number;
  /** Claim đơn sàn KHÁC của thành viên đã cộng điểm và còn đứng (đơn chưa huỷ, hoàn; không vướng cờ hoàn một phần). */
  creditedClaims: number;
  recipientNameMatch: AdminRecipientNameMatch;
  ok: boolean;
  outcome: StaleBatchOutcome;
  /** Vì sao không duyệt nhanh (để duyệt tay từng claim); null khi ok. */
  reason: string | null;
}

export interface NoPhoneBatchResponse {
  dryRun: boolean;
  total: number;
  okCount: number;
  skippedCount: number;
  failedCount: number;
  /** Còn claim chờ vì đơn Lazada thiếu SĐT ngoài lượt này (danh sách cắt ở NO_PHONE_BATCH_MAX). */
  truncated: boolean;
  results: NoPhoneBatchRow[];
  auditLogId: string | null;
  auditError: string | null;
}

const CLAIM_INCLUDE = { externalOrder: true } satisfies Prisma.ExternalPointsClaimInclude;
const MEMBER_SELECT = { id: true, fullName: true, phone: true, phoneVerifiedAt: true, zaloId: true, isBlocked: true, role: true, mergedIntoId: true } as const;
const ORDER_STATUS_TEXT: Record<string, string> = {
  RETURNING: 'đang hoàn',
  PARTIAL_RETURN: 'đã hoàn một phần',
  RETURNED: 'đã hoàn',
  CANCELLED: 'đã huỷ',
  DELETED: 'đã xoá',
};

function storedRecipient(payload: Prisma.JsonValue): unknown {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>)[RECIPIENT_PAYLOAD_KEY] : undefined;
}

interface GuardCtx {
  now: Date;
  cfg: ClaimConfig;
}

/**
 * Vì sao claim này KHÔNG được duyệt nhanh (null = được). Lý do REVIEW chỉ giữ lý do đầu của chuỗi luật, và "đơn sàn thiếu SĐT" đứng cuối
 * chuỗi (`evaluateClaimRules`): lúc tạo claim không vướng tiền hàng lạ, mã mở lại, nhân viên, hoàn một phần hay ngưỡng tiền. Từ lúc đó tới
 * giờ đơn và thành viên có thể đã đổi, nên mọi điều đó được xét lại ở đây, thêm điều kiện của PO (W45): đơn Lazada; thành viên còn đủ điều
 * kiện tích điểm (SĐT đã xác minh qua Zalo, không khoá, không gộp, không phải nhân viên) và là khách quen (ít nhất một đơn app tự đặt đã
 * nhận, hoặc một claim đơn sàn khác đã cộng mà đơn chưa huỷ hay hoàn); SĐT trên đơn không lệch; tên người nhận không khác tên thành viên. Trần tháng xét chặt (không
 * chốt xuống như nút Duyệt).
 */
export async function noPhoneOnlyBlock(db: Prisma.TransactionClient, c: LockedClaim, ctx: GuardCtx): Promise<string | null> {
  if (c.kind !== 'SCAN' || c.state !== 'REVIEW' || c.reviewReason !== NO_PHONE_REVIEW_REASON) return 'Claim không còn chờ duyệt vì đơn sàn thiếu SĐT.';
  const o = c.externalOrder;
  if (o.channel !== NO_PHONE_BATCH_CHANNEL) return 'Chỉ duyệt nhanh đơn Lazada: duyệt tay.';
  if (!c.userId) return 'Claim chưa gắn thành viên.';
  const u = await db.user.findUnique({ where: { id: c.userId }, select: MEMBER_SELECT });
  if (!u || !isRealUser(u) || !u.phone || !u.phoneVerifiedAt || u.isBlocked || u.mergedIntoId) {
    return 'Thành viên không còn đủ điều kiện (chưa xác minh SĐT, bị khoá hoặc đã gộp tài khoản): duyệt tay.';
  }
  if (u.role === 'STAFF' || u.role === 'ADMIN') return 'Thành viên là nhân viên Tubu Tree: duyệt tay.';
  if (orderPhoneMatch(u.phone, o) === 'MISMATCH') return 'SĐT trên đơn nay đọc được và khác SĐT thành viên: duyệt tay.';
  const [delivered, credited] = await Promise.all([
    db.order.count({ where: { userId: u.id, ...DIRECT_APP_DELIVERED_WHERE } }),
    db.externalPointsClaim.count({ where: { userId: u.id, ...STANDING_CREDITED_SCAN_WHERE, id: { not: c.id } } }),
  ]);
  if (delivered < 1 && credited < 1) return 'Thành viên chưa nhận đơn app nào và chưa có đơn sàn nào đã cộng điểm: duyệt tay.';
  if (recipientNameMatch(storedRecipient(o.lastPayload), u.fullName) === 'MISMATCH') return 'Tên người nhận trên đơn khác tên thành viên: duyệt tay.';
  if (o.status !== 'OPEN' && o.status !== 'DELIVERED') return `Đơn ${ORDER_STATUS_TEXT[o.status] ?? o.status}: duyệt tay.`;
  const points = claimPoints(o.goodsValue, Number(c.ratePct));
  if (points === null || points <= 0) return 'Đơn chưa tính được tiền hàng: duyệt tay.';
  if ((o.goodsValue ?? 0) > ctx.cfg.reviewAboveVnd) return 'Giá trị đơn vượt ngưỡng tự duyệt: duyệt tay.';
  const month = await db.externalPointsClaim.aggregate({
    where: { userId: u.id, kind: 'SCAN', id: { not: c.id }, createdAt: { gte: startOfVnMonth(c.createdAt), lt: startOfNextVnMonth(c.createdAt) }, state: { in: ['PENDING', 'REVIEW', 'CREDITED'] } },
    _sum: { points: true },
  });
  if ((month._sum.points ?? 0) + points > ctx.cfg.monthlyPointsCap) return 'Vượt trần điểm tháng của thành viên: duyệt tay (nút Duyệt chốt theo phần trần còn lại).';
  return null;
}

/**
 * Nút "Duyệt nhanh đơn Lazada đủ điều kiện" (PO W45): CSKH bấm, máy chủ duyệt từng claim đơn sàn đang chờ CHỈ vì đơn không có SĐT để đối
 * chiếu (Lazada che `***`). Không tự chạy: không cron, mỗi lượt do người bấm và ghi `admin_audit_logs`, nhật ký APPROVE từng claim mang dấu
 * của lượt. Xem trước (dryRun) quét tối đa 50 claim cũ nhất; lượt thật nhận đúng danh sách vừa xem và duyệt từng claim qua
 * `ExternalClaimsAdminService.approve` (chặn tự duyệt, người gắn đơn, tính lại điểm), với `noPhoneOnlyBlock` chạy lại dưới khoá thành
 * viên/đơn/claim của chính lượt duyệt.
 */
@Injectable()
export class ExternalClaimsNoPhoneBatchService {
  private readonly logger = new Logger(ExternalClaimsNoPhoneBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly admin: ExternalClaimsAdminService,
  ) {}

  async run(actorId: string, input: { dryRun?: boolean; claimIds?: readonly string[] }, now: Date = new Date()): Promise<NoPhoneBatchResponse> {
    const dryRun = input.dryRun !== false;
    const ids = [...new Set((input.claimIds ?? []).map((s) => s.trim()).filter(Boolean))];
    if (!dryRun && ids.length === 0) throw new BadRequestException('Duyệt nhanh cần danh sách claim đã xem trước.');
    if (ids.length > NO_PHONE_BATCH_MAX) throw new BadRequestException(`Mỗi lượt tối đa ${NO_PHONE_BATCH_MAX} claim.`);

    const ctx: GuardCtx = { now, cfg: await loadClaimConfig(this.config) };
    const found = await this.prisma.externalPointsClaim.findMany({
      where: ids.length > 0 ? { id: { in: ids } } : { kind: 'SCAN', state: 'REVIEW', reviewReason: NO_PHONE_REVIEW_REASON, externalOrder: { channel: NO_PHONE_BATCH_CHANNEL } },
      include: CLAIM_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: NO_PHONE_BATCH_MAX + 1,
    });
    const truncated = ids.length === 0 && found.length > NO_PHONE_BATCH_MAX;
    const claims = found.slice(0, NO_PHONE_BATCH_MAX);
    const byId = new Map(claims.map((c) => [c.id, c]));
    const order = ids.length > 0 ? ids : claims.map((c) => c.id);

    const userIds = [...new Set(claims.map((c) => c.userId).filter((u): u is string => !!u))];
    const [users, delivered, credited] = userIds.length
      ? await Promise.all([
          this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, phone: true } }),
          this.prisma.order.groupBy({ by: ['userId'], where: { userId: { in: userIds }, ...DIRECT_APP_DELIVERED_WHERE }, _count: { _all: true } }),
          this.prisma.externalPointsClaim.groupBy({ by: ['userId'], where: { userId: { in: userIds }, ...STANDING_CREDITED_SCAN_WHERE }, _count: { _all: true } }),
        ])
      : [[], [], []];
    const userOf = new Map(users.map((u) => [u.id, u]));
    const deliveredOf = new Map(delivered.map((d) => [d.userId, d._count._all]));
    const creditedOf = new Map(credited.map((d) => [d.userId ?? '', d._count._all]));
    const actorRoot = await canonicalUserId(this.prisma, actorId);

    const results: NoPhoneBatchRow[] = [];
    for (const id of order) {
      const c = byId.get(id);
      if (!c) {
        results.push({
          id, maskedCode: '', userName: null, userPhoneMasked: null, points: 0, deliveredAppOrders: 0, creditedClaims: 0, recipientNameMatch: 'NO_DATA',
          ok: false, outcome: 'FAILED', reason: 'Không tìm thấy claim.',
        });
        continue;
      }
      const u = c.userId ? userOf.get(c.userId) : undefined;
      const row: NoPhoneBatchRow = {
        id,
        maskedCode: maskClaimCode(c.externalOrder.trackingCode),
        userName: u?.fullName ?? null,
        userPhoneMasked: maskPhoneOrNull(u?.phone),
        points: c.points,
        deliveredAppOrders: c.userId ? (deliveredOf.get(c.userId) ?? 0) : 0,
        // Claim đang xét chưa cộng (REVIEW), nên số đếm CREDITED của thành viên đã là số claim KHÁC.
        creditedClaims: c.userId ? (creditedOf.get(c.userId) ?? 0) : 0,
        recipientNameMatch: u ? recipientNameMatch(storedRecipient(c.externalOrder.lastPayload), u.fullName) : 'NO_DATA',
        ok: false,
        outcome: 'FAILED',
        reason: null,
      };
      results.push(row);
      if (c.state !== 'REVIEW' || c.reviewReason !== NO_PHONE_REVIEW_REASON) {
        Object.assign(row, { outcome: 'SKIPPED', reason: 'Claim đã được xử lý hoặc không còn chờ vì đơn thiếu SĐT.' });
        continue;
      }
      if (c.userId && (c.userId === actorId || (await canonicalUserId(this.prisma, c.userId)) === actorRoot)) {
        row.reason = 'Bạn không được xử lý claim của chính mình.';
        continue;
      }
      const block = await noPhoneOnlyBlock(this.prisma, c, ctx);
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
          await this.admin.approve(row.id, actorId, now, undefined, { guard: (tx, c) => noPhoneOnlyBlock(tx, c, ctx), eventNote: NO_PHONE_BATCH_NOTE });
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
          action: NO_PHONE_BATCH_AUDIT_ACTION,
          targetType: 'EXTERNAL_POINTS_CLAIM',
          targetIds: approved,
          payload: {
            requested: ids,
            approved,
            note: NO_PHONE_BATCH_NOTE,
            channel: NO_PHONE_BATCH_CHANNEL,
            rows: results.map((r) => ({
              id: r.id,
              outcome: r.outcome,
              points: r.points,
              deliveredAppOrders: r.deliveredAppOrders,
              creditedClaims: r.creditedClaims,
              recipientNameMatch: r.recipientNameMatch,
              reason: r.reason,
            })),
          },
        },
        select: { id: true },
      });
      auditLogId = log.id;
    } catch (err) {
      auditError = `Chưa ghi được sổ thao tác quản trị (${describeError(err)}).`;
      this.logger.error(`Duyệt nhanh Lazada thiếu SĐT của ${actorId} đã chạy nhưng ghi admin_audit_logs lỗi: duyệt ${approved.join(', ') || 'không claim nào'}; ${describeError(err)}`);
    }
    this.logger.warn(`${actorId} duyệt nhanh claim Lazada thiếu SĐT: duyệt ${okCount}, bỏ qua ${skippedCount}, lỗi ${base.failedCount} / ${results.length}`);
    return { ...base, auditLogId, auditError };
  }
}
