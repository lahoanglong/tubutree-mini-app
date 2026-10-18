import type { ExternalClaimState, ExternalOrderStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatPoints } from '../../common/format-points';
import type { PrismaService } from '../../prisma/prisma.service';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { externalLotKey, loadPointExpiryTxns, lotRecoverable } from '../loyalty/loyalty-expiry.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { loadClaimConfig } from './external-claim.config';
import { claimPoints, maskClaimCode } from './external-points-rate';

const logger = new Logger('ExternalClaimStatus');

export type ClaimNotifier = { notify: (userId: string, templateCode: string, data: Record<string, string>, opts?: { dedupeKey?: string }) => Promise<void> };

/** Lý do tự động huỷ vì đơn bị huỷ/hoàn trên sàn: dòng có `decidedById` null và lý do này là do hệ thống, không phải do nhân viên. */
export const AUTO_VOID_REASON = 'Đơn bị huỷ, hoàn hoặc xoá trên sàn';
export const AUTO_REVERSE_REASON = 'Đơn bị huỷ, hoàn hoặc xoá trên sàn sau khi đã cộng điểm';

export type StatusAction = 'NONE' | 'VOID' | 'REVERSE' | 'TO_REVIEW' | 'FLAG_PARTIAL' | 'SYNC_RELEASE';

export interface ClaimStatusFacts {
  state: ExternalClaimState;
  /** VOIDED do hệ thống (đơn bị huỷ) chứ không phải nhân viên quyết định. */
  autoVoided: boolean;
  /** CREDITED đã được gắn cờ hoàn một phần. */
  flaggedPartial: boolean;
  /** Nhân viên đã duyệt claim này: hoàn một phần không được đẩy nó về REVIEW lần nữa sau mỗi webhook. */
  humanDecided?: boolean;
}

const CLOSED: readonly ExternalOrderStatus[] = ['RETURNED', 'CANCELLED', 'DELETED'];
const UNPAID: readonly ExternalClaimState[] = ['PENDING', 'REVIEW', 'HELD_NO_MEMBER'];

/**
 * Trạng thái Pancake mới của đơn quyết định việc làm với claim (HÀM THUẦN). 4 đang hoàn: giữ. 5/6/7: chưa cộng thì huỷ claim, đã cộng
 * thì đảo điểm. 15 hoàn một phần: chưa cộng thì REVIEW, đã cộng thì vào hàng cần xử lý. Giao sau khi hệ thống đã huỷ: REVIEW.
 */
export function decideStatusAction(orderStatus: ExternalOrderStatus, c: ClaimStatusFacts): { action: StatusAction; reason?: string } {
  if (CLOSED.includes(orderStatus)) {
    if (UNPAID.includes(c.state)) return { action: 'VOID' };
    if (c.state === 'CREDITED') return { action: 'REVERSE' };
    return { action: 'NONE' };
  }
  if (orderStatus === 'PARTIAL_RETURN') {
    if (c.state === 'PENDING') return c.humanDecided ? { action: 'NONE' } : { action: 'TO_REVIEW', reason: 'Đơn hoàn một phần trên sàn, cần nhân viên kiểm' };
    if (c.state === 'CREDITED' && !c.flaggedPartial) return { action: 'FLAG_PARTIAL', reason: 'Đơn hoàn một phần sau khi đã cộng điểm' };
    return { action: 'NONE' };
  }
  if (orderStatus === 'DELIVERED') {
    if (c.state === 'PENDING' || c.state === 'REVIEW') return { action: 'SYNC_RELEASE' };
    if (c.state === 'VOIDED' && c.autoVoided) return { action: 'TO_REVIEW', reason: 'Đơn được giao sau khi đã bị huỷ hoặc hoàn trên sàn' };
  }
  return { action: 'NONE' };
}

export interface ReverseResult {
  claimId: string;
  reversedPoints: number;
}

/**
 * Đảo điểm đã cộng của một claim: thu hồi `min(điểm đã cộng, phần lô còn thu hồi được, số dư)` như reverseOrderPoints (PF-3), không
 * bao giờ làm số dư âm và không đòi lại điểm đã hết hạn. Khoá claim rồi mới tới users (cùng chiều với lúc cộng). Idempotent theo
 * trạng thái claim; unique sổ điểm (reason, refId) là chốt chặn cuối. null = claim không còn ở CREDITED.
 */
export async function reverseCreditedClaim(
  prisma: PrismaService,
  claimId: string,
  by: { reason: string; actorId: string | null },
): Promise<ReverseResult | null> {
  return prisma.$transaction(async (tx) => {
    const [claim] = await tx.$queryRaw<{ id: string; userId: string | null; points: number; externalOrderId: string }[]>`
      SELECT "id", "userId", "points", "externalOrderId" FROM "external_points_claims" WHERE "id" = ${claimId} AND "state" = 'CREDITED' FOR UPDATE`;
    if (!claim || !claim.userId) return null;
    const [user] = await tx.$queryRaw<{ pointsBalance: number }[]>`SELECT "pointsBalance" FROM "users" WHERE "id" = ${claim.userId} FOR UPDATE`;
    const order = await tx.externalOrder.findUniqueOrThrow({ where: { id: claim.externalOrderId }, select: { pancakeOrderId: true, source: true } });
    const recoverable = lotRecoverable(await loadPointExpiryTxns(tx, claim.userId), externalLotKey(claim.id));
    const take = Math.max(0, Math.min(claim.points, recoverable ?? claim.points, user?.pointsBalance ?? 0));
    const done = await tx.externalPointsClaim.updateMany({
      where: { id: claim.id, state: 'CREDITED' },
      data: { state: 'REVERSED', voidReason: by.reason, decidedById: by.actorId },
    });
    if (done.count !== 1) return null;
    if (take > 0) {
      const prefix = order.source === 'CHAT' ? 'PANCAKE_CHAT_ORDER_REVERSED' : 'MARKETPLACE_ORDER_REVERSED';
      const res = await applyPointsDelta(tx, {
        userId: claim.userId,
        delta: -take,
        lot: 'STANDARD',
        reason: `${prefix}:${order.pancakeOrderId}`,
        refType: 'EXTERNAL_ORDER',
        refId: claim.id,
      });
      if (!res.applied) throw new Error(`reverseCreditedClaim ${claim.id}: số dư đổi giữa chừng`);
    }
    if (take < claim.points) logger.log(`reverseCreditedClaim claim=${claim.id}: thu hồi ${take}/${claim.points} điểm (phần còn lại đã hết hạn, đã mất hoặc vượt số dư)`);
    return { claimId: claim.id, reversedPoints: take };
  });
}

async function notifySafe(notifier: ClaimNotifier | undefined, userId: string | null, code: string, data: Record<string, string>, dedupeKey: string): Promise<void> {
  if (!notifier || !userId) return;
  try {
    await notifier.notify(userId, code, data, { dedupeKey });
  } catch (err) {
    logger.warn(`Gửi ${code} lỗi (claim ${dedupeKey}): ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Nối trạng thái đơn ngoài (đã ghi bởi ingestExternalOrder) vào claim của nó. Idempotent và chịu chạy lặp: quyết định chỉ dựa trên
 * trạng thái hiện tại của đơn và claim, mọi ghi đều có điều kiện trạng thái. Không ném lỗi ra ngoài đường webhook: lỗi chỉ log để
 * lần nạp kế tiếp (hoặc cron kéo dự phòng) thử lại.
 */
export async function applyStatusToClaim(
  prisma: PrismaService,
  notifier: ClaimNotifier | undefined,
  config: Pick<SystemConfigService, 'get'> | undefined,
  pancakeOrderId: string,
): Promise<StatusAction> {
  try {
    const order = await prisma.externalOrder.findUnique({ where: { pancakeOrderId }, include: { claim: true } });
    const claim = order?.claim;
    if (!order || !claim) return 'NONE';
    const { action, reason } = decideStatusAction(order.status, {
      state: claim.state,
      autoVoided: claim.state === 'VOIDED' && claim.decidedById === null,
      flaggedPartial: claim.reviewReason !== null,
      humanDecided: claim.decidedById !== null,
    });
    const code = maskClaimCode(order.trackingCode);
    switch (action) {
      case 'VOID': {
        const res = await prisma.externalPointsClaim.updateMany({
          where: { id: claim.id, state: { in: [...UNPAID] } },
          data: { state: 'VOIDED', voidReason: AUTO_VOID_REASON, decidedById: null },
        });
        if (res.count === 1) await notifySafe(notifier, claim.userId, 'EXTERNAL_POINTS_VOIDED', { code, detail: 'điểm chờ không được cộng' }, `ext-void:${claim.id}`);
        break;
      }
      case 'REVERSE': {
        const res = await reverseCreditedClaim(prisma, claim.id, { reason: AUTO_REVERSE_REASON, actorId: null });
        if (res) {
          await notifySafe(
            notifier,
            claim.userId,
            'EXTERNAL_POINTS_VOIDED',
            { code, detail: res.reversedPoints > 0 ? `${formatPoints(res.reversedPoints)} Điểm Xanh đã cộng được thu hồi` : 'điểm đã cộng không còn gì để thu hồi' },
            `ext-reverse:${claim.id}`,
          );
        }
        break;
      }
      case 'TO_REVIEW':
        await prisma.externalPointsClaim.updateMany({
          where: { id: claim.id, OR: [{ state: 'PENDING' }, { state: 'VOIDED', decidedById: null }] },
          data: { state: 'REVIEW', reviewReason: reason ?? null, voidReason: null },
        });
        break;
      case 'FLAG_PARTIAL':
        await prisma.externalPointsClaim.updateMany({ where: { id: claim.id, state: 'CREDITED', reviewReason: null }, data: { reviewReason: reason ?? null } });
        break;
      case 'SYNC_RELEASE': {
        if (!order.deliveredAt) break;
        const cfg = config ? await loadClaimConfig(config) : { pendingDays: 14, earnPct: Number(claim.ratePct) };
        const releaseAt = new Date(order.deliveredAt.getTime() + cfg.pendingDays * 864e5);
        // Còn PENDING thì tính lại theo tiền hàng mới nhất; tới lúc cộng mới chốt (releaseClaim).
        const fresh = claim.state === 'PENDING' ? claimPoints(order.goodsValue, Number(claim.ratePct)) : null;
        await prisma.externalPointsClaim.updateMany({
          where: { id: claim.id, state: { in: ['PENDING', 'REVIEW'] } },
          data: { releaseAt, ...(fresh !== null && fresh > 0 ? { points: fresh } : {}) },
        });
        break;
      }
      case 'NONE':
        break;
    }
    return action;
  } catch (err) {
    logger.error(`applyStatusToClaim ${pancakeOrderId} lỗi: ${err instanceof Error ? err.message : err}`);
    return 'NONE';
  }
}

export const isUniqueViolation = (err: unknown): boolean => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
