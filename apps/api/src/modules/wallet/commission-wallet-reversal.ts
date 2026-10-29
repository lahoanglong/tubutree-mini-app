import { Prisma, type CommissionStatus } from '@prisma/client';
import { anonymizedAtOf } from './wallet-anonymized-guard';
import { applyWalletDelta } from './wallet-ledger.service';

/**
 * Hoa hồng đang ở đâu khi đơn bị trả:
 * - UNPAID: chưa có đồng nào rời khỏi Tubu (chưa chốt, hoặc APPROVED chưa chuyển vào Ví): chỉ đổi trạng thái/giảm số.
 * - WALLET: PAID qua requestPayout, tiền đã nằm trong Ví CTV: thu hồi bằng một dòng COMMISSION_REVERSAL.
 * - LEGACY: nằm trong lệnh rút ngân hàng cũ (payoutBatchId gán): chờ chuyển hoặc đã chuyển ra ngoài, không trừ Ví được.
 * requestPayout đánh dấu PAID mà không gán payoutBatchId; chỉ lệnh rút ngân hàng cũ mới gán nó.
 */
export type CommissionHolding = 'UNPAID' | 'WALLET' | 'LEGACY' | 'REJECTED';

export function commissionHolding(c: { status: CommissionStatus; payoutBatchId: string | null }): CommissionHolding {
  if (c.status === 'REJECTED') return 'REJECTED';
  if (c.status === 'PENDING' || c.status === 'LOCKED') return 'UNPAID';
  if (c.payoutBatchId !== null) return 'LEGACY';
  return c.status === 'PAID' ? 'WALLET' : 'UNPAID';
}

/** Một khoản hoa hồng đã trừ Ví CTV khi đơn bị trả (balanceAfter < 0: Ví CTV đang âm). */
export interface CommissionDebitNote {
  affiliateUserId: string;
  amount: number;
  balanceAfter: number;
}

/** Khoản hoa hồng của đơn bị trả mà hệ thống không tự trừ được: kế toán xử lý tay. */
export interface CommissionManualNote {
  affiliateUserId: string;
  amount: number;
  /** LEGACY_PAYOUT: nằm trong lệnh rút ngân hàng cũ. ANONYMIZED: CTV đã xoá tài khoản (Ví đã về 0). */
  reason: 'LEGACY_PAYOUT' | 'ANONYMIZED';
}

/**
 * Thứ tự khoá cho lần trả một phần: dòng hoa hồng của đơn trước (requestPayout khoá dòng hoa hồng rồi mới tới Ví CTV, nên đi ngược
 * lại là 40P01), rồi Ví của khách và của CTV theo thứ tự id (hai đơn có vai trò đảo nhau, khách A với CTV B và khách B với CTV A,
 * không giữ mỗi bên một dòng rồi chờ dòng kia). Chỉ khoá user khi có hoa hồng đã vào Ví (chỗ duy nhất sẽ trừ Ví CTV) và hai bên là hai người.
 */
export async function lockCommissionsAndWallets(tx: Prisma.TransactionClient, order: { id: string; userId: string }): Promise<void> {
  const rows = await tx.$queryRaw<{ affiliateUserId: string; status: CommissionStatus; payoutBatchId: string | null }[]>`
    SELECT "affiliateUserId", "status", "payoutBatchId" FROM "commissions" WHERE "orderId" = ${order.id} ORDER BY "id" FOR NO KEY UPDATE`;
  const owners = (rows ?? []).filter((r) => commissionHolding(r) === 'WALLET').map((r) => r.affiliateUserId);
  const ids = [...new Set([order.userId, ...owners])];
  if (owners.length === 0 || ids.length < 2) return;
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR NO KEY UPDATE`;
}

export type CommissionDebitResult =
  | { debited: true; applied: boolean; balanceAfter: number }
  /** Tài khoản CTV đã ẩn danh (Ví đã về 0, không ai đăng nhập): không trừ, kế toán xử lý tay. */
  | { debited: false; anonymizedAt: string };

/**
 * Trừ Ví CTV phần hoa hồng bị thu hồi (số dư được phép âm). refId duy nhất cho mỗi lần thu hồi: id hoa hồng cho lần trả cả đơn,
 * `<id hoa hồng>:<id yêu cầu trả>` cho từng lần trả một phần, nên chạy lại không trừ hai lần. Đọc cờ ẩn danh và trừ là một
 * bước dưới cùng khoá dòng user (cùng cách creditWalletUnlessAnonymized).
 */
export async function debitCommissionFromWallet(
  tx: Prisma.TransactionClient,
  input: { userId: string; amount: number; refId: string; reason: string },
): Promise<CommissionDebitResult> {
  const rows = await tx.$queryRaw<{ metadata: unknown }[]>`SELECT "metadata" FROM "users" WHERE "id" = ${input.userId} FOR NO KEY UPDATE`;
  const anonymizedAt = anonymizedAtOf(rows?.[0]?.metadata);
  if (anonymizedAt) return { debited: false, anonymizedAt };
  const res = await applyWalletDelta(tx, {
    userId: input.userId,
    delta: -input.amount,
    type: 'COMMISSION_REVERSAL',
    refType: 'COMMISSION',
    refId: input.refId,
    reason: input.reason,
    allowNegative: true,
  });
  return { debited: true, applied: res.applied, balanceAfter: res.balanceAfter };
}
