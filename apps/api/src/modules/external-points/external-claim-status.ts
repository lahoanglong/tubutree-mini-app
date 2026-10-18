import type { ExternalClaimState, ExternalOrderStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatPoints } from '../../common/format-points';
import type { PrismaService } from '../../prisma/prisma.service';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { externalLotKey, loadPointExpiryTxns, lotRecoverable } from '../loyalty/loyalty-expiry.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { loadClaimConfig } from './external-claim.config';
import { decidedAtPartialReturn, recordClaimEvent } from './external-claim-audit';
import { claimCodeLabel } from './external-points-rate';

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

type Tx = Prisma.TransactionClient;

/**
 * Thứ tự khoá MỌI đường: dòng đơn (FOR SHARE) rồi dòng claim (FOR UPDATE) rồi dòng users. FOR SHARE ở đơn chặn webhook đang ghi đơn
 * (UPDATE cần khoá mạnh hơn) và cho các đường đọc đơn song song đi cùng nhau; claim FOR UPDATE xếp hàng các đường đổi claim. Đảo
 * thứ tự ở bất kỳ đâu sẽ deadlock với cron cộng điểm.
 */
export async function lockOrderThenClaim(tx: Tx, claimId: string): Promise<{ orderId: string } | null> {
  const head = await tx.externalPointsClaim.findUnique({ where: { id: claimId }, select: { externalOrderId: true } });
  if (!head) return null;
  await tx.$queryRaw`SELECT "id" FROM "external_orders" WHERE "id" = ${head.externalOrderId} FOR SHARE`;
  return { orderId: head.externalOrderId };
}

/**
 * Đảo điểm đã cộng của một claim TRONG transaction của caller: thu hồi `min(điểm đã cộng, phần lô còn thu hồi được, số dư)` như
 * reverseOrderPoints (PF-3), không bao giờ làm số dư âm và không đòi lại điểm đã hết hạn. Idempotent theo trạng thái claim; unique
 * sổ điểm (reason, refId) là chốt chặn cuối. null = claim không còn ở CREDITED.
 */
export async function reverseCreditedClaimTx(
  tx: Tx,
  claimId: string,
  by: { reason: string; actorId: string | null },
): Promise<ReverseResult | null> {
  if (!(await lockOrderThenClaim(tx, claimId))) return null;
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
  await recordClaimEvent(tx, {
    claimId: claim.id,
    action: by.actorId ? 'REVERSE' : 'AUTO_REVERSE',
    actorId: by.actorId,
    fromState: 'CREDITED',
    toState: 'REVERSED',
    userIdBefore: claim.userId,
    userIdAfter: claim.userId,
    note: `${by.reason} (thu hồi ${take}/${claim.points} điểm)`,
  });
  if (take < claim.points) logger.log(`reverseCreditedClaim claim=${claim.id}: thu hồi ${take}/${claim.points} điểm (phần còn lại đã hết hạn, đã mất hoặc vượt số dư)`);
  return { claimId: claim.id, reversedPoints: take };
}

export function reverseCreditedClaim(prisma: PrismaService, claimId: string, by: { reason: string; actorId: string | null }): Promise<ReverseResult | null> {
  return prisma.$transaction((tx) => reverseCreditedClaimTx(tx, claimId, by));
}

async function notifySafe(notifier: ClaimNotifier | undefined, userId: string | null, code: string, data: Record<string, string>, dedupeKey: string): Promise<void> {
  if (!notifier || !userId) return;
  try {
    await notifier.notify(userId, code, data, { dedupeKey });
  } catch (err) {
    logger.warn(`Gửi ${code} lỗi (claim ${dedupeKey}): ${err instanceof Error ? err.message : err}`);
  }
}

interface AppliedNotice {
  action: StatusAction;
  userId: string | null;
  claimId: string;
  code: string;
  detail: string | null;
  dedupeKey: string | null;
  /** Claim đang tính vào xét hạng (đơn chat): đảo điểm xong thì hạng phải được tính lại. */
  countsForTier: boolean;
}

export interface StatusHooks {
  recalcTier?: (userId: string) => Promise<void>;
}

/**
 * Nối trạng thái đơn ngoài (đã ghi bởi ingestExternalOrder) vào claim của nó. Chạy trong MỘT transaction: khoá đơn rồi claim, ĐỌC LẠI
 * claim sau khoá rồi mới quyết, nên một lượt cộng điểm chen vào (claim vừa thành CREDITED) được thấy và đi nhánh đảo điểm thay vì
 * bị bỏ lỡ. Không ném lỗi ra ngoài đường webhook: lỗi chỉ log để lần nạp kế tiếp (hoặc cron kéo dự phòng) thử lại.
 */
export async function applyStatusToClaim(
  prisma: PrismaService,
  notifier: ClaimNotifier | undefined,
  config: Pick<SystemConfigService, 'get'> | undefined,
  pancakeOrderId: string,
  hooks: StatusHooks = {},
): Promise<StatusAction> {
  try {
    const pendingDays = config ? (await loadClaimConfig(config)).pendingDays : 14;
    let notice: AppliedNotice | null = null;
    // Vòng thử lại: sau khoá, điều kiện trạng thái không thể trượt; vẫn đọc lại và quyết lại nếu một ghi có điều kiện không trúng.
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "external_orders" WHERE "pancakeOrderId" = ${pancakeOrderId} FOR SHARE`;
        if (!locked) return { retry: false, notice: null };
        const head = await tx.externalPointsClaim.findUnique({ where: { externalOrderId: locked.id }, select: { id: true } });
        if (!head) return { retry: false, notice: null };
        await tx.$queryRaw`SELECT "id" FROM "external_points_claims" WHERE "id" = ${head.id} FOR UPDATE`;
        const order = await tx.externalOrder.findUniqueOrThrow({ where: { id: locked.id }, include: { claim: true } });
        const claim = order.claim;
        if (!claim) return { retry: false, notice: null };
        const kept = (await tx.externalClaimEvent.count({ where: { claimId: claim.id, action: 'KEEP_POINTS' } })) > 0;
        const { action, reason } = decideStatusAction(order.status, {
          state: claim.state,
          autoVoided: claim.state === 'VOIDED' && claim.decidedById === null,
          flaggedPartial: claim.reviewReason !== null || kept,
          humanDecided: claim.decidedById !== null && (await decidedAtPartialReturn(tx, claim.id)),
        });
        // Đơn chat thường không có mã đáng hiện cho khách: thay bằng cách gọi chung để câu thông báo không bị trống.
        const code = claimCodeLabel(order.trackingCode, claim.kind);
        const base = { action, userId: claim.userId, claimId: claim.id, code, detail: null as string | null, dedupeKey: null as string | null, countsForTier: claim.countsForTier };
        switch (action) {
          case 'VOID': {
            const res = await tx.externalPointsClaim.updateMany({
              where: { id: claim.id, state: { in: [...UNPAID] } },
              data: { state: 'VOIDED', voidReason: AUTO_VOID_REASON, decidedById: null },
            });
            if (res.count !== 1) return { retry: true, notice: null };
            await recordClaimEvent(tx, { claimId: claim.id, action: 'AUTO_VOID', fromState: claim.state, toState: 'VOIDED', userIdBefore: claim.userId, userIdAfter: claim.userId, note: AUTO_VOID_REASON });
            return { retry: false, notice: { ...base, detail: 'điểm chờ không được cộng', dedupeKey: `ext-void:${claim.id}` } };
          }
          case 'REVERSE': {
            const res = await reverseCreditedClaimTx(tx, claim.id, { reason: AUTO_REVERSE_REASON, actorId: null });
            if (!res) return { retry: true, notice: null };
            return {
              retry: false,
              notice: {
                ...base,
                detail: res.reversedPoints > 0 ? `${formatPoints(res.reversedPoints)} Điểm Xanh đã cộng được thu hồi` : 'điểm đã cộng không còn gì để thu hồi',
                dedupeKey: `ext-reverse:${claim.id}`,
              },
            };
          }
          case 'TO_REVIEW': {
            const res = await tx.externalPointsClaim.updateMany({
              where: { id: claim.id, OR: [{ state: 'PENDING' }, { state: 'VOIDED', decidedById: null }] },
              data: { state: 'REVIEW', reviewReason: reason ?? null, voidReason: null },
            });
            if (res.count !== 1) return { retry: true, notice: null };
            await recordClaimEvent(tx, { claimId: claim.id, action: 'TO_REVIEW', fromState: claim.state, toState: 'REVIEW', userIdBefore: claim.userId, userIdAfter: claim.userId, note: reason ?? null });
            return { retry: false, notice: base };
          }
          case 'FLAG_PARTIAL': {
            const res = await tx.externalPointsClaim.updateMany({ where: { id: claim.id, state: 'CREDITED', reviewReason: null }, data: { reviewReason: reason ?? null } });
            if (res.count === 1) {
              await recordClaimEvent(tx, { claimId: claim.id, action: 'FLAG_PARTIAL', fromState: 'CREDITED', toState: 'CREDITED', userIdBefore: claim.userId, userIdAfter: claim.userId, note: reason ?? null });
            }
            return { retry: false, notice: base };
          }
          case 'SYNC_RELEASE': {
            if (!order.deliveredAt) return { retry: false, notice: base };
            // Chỉ đồng bộ mốc cộng; điểm chốt lúc cộng (releaseClaim) theo tiền hàng mới nhất.
            const releaseAt = new Date(order.deliveredAt.getTime() + pendingDays * 864e5);
            await tx.externalPointsClaim.updateMany({ where: { id: claim.id, state: { in: ['PENDING', 'REVIEW'] } }, data: { releaseAt } });
            return { retry: false, notice: base };
          }
          case 'NONE':
            return { retry: false, notice: base };
        }
      });
      notice = out.notice;
      if (!out.retry) break;
    }
    if (!notice) return 'NONE';
    if (notice.action === 'REVERSE' && notice.countsForTier && notice.userId && hooks.recalcTier) {
      await hooks.recalcTier(notice.userId).catch((e: unknown) => logger.warn(`recalcTier sau đảo điểm lỗi user=${notice.userId}: ${e instanceof Error ? e.message : e}`));
    }
    if ((notice.action === 'VOID' || notice.action === 'REVERSE') && notice.dedupeKey) {
      await notifySafe(notifier, notice.userId, 'EXTERNAL_POINTS_VOIDED', { code: notice.code, detail: notice.detail ?? '' }, notice.dedupeKey);
    }
    return notice.action;
  } catch (err) {
    logger.error(`applyStatusToClaim ${pancakeOrderId} lỗi: ${err instanceof Error ? err.message : err}`);
    return 'NONE';
  }
}

export const isUniqueViolation = (err: unknown): boolean => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
