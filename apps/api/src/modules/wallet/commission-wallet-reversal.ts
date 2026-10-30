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

/**
 * Một khoản hoa hồng đã thu hồi từ Ví CTV khi đơn bị trả. `amount` là hoa hồng bị thu hồi (số gộp), `walletDebit` là số đã trừ khỏi
 * Ví: chỉ phần thực nhận của hoa hồng, vì lệnh chuyển gốc chỉ cộng vào Ví sau khi trừ thuế TNCN. `taxWithheld` là thuế thực giữ của
 * lệnh chuyển gốc (> 0 thì tờ khai thuế đã kê thu nhập của khoản vừa thu hồi, kế toán cần xem lại). balanceAfter < 0: Ví CTV đang âm.
 */
export interface CommissionDebitNote {
  affiliateUserId: string;
  amount: number;
  walletDebit: number;
  taxWithheld: number;
  balanceAfter: number;
}

/** Khoản hoa hồng của đơn bị trả mà hệ thống không tự trừ được: kế toán xử lý tay. */
export interface CommissionManualNote {
  affiliateUserId: string;
  amount: number;
  /**
   * LEGACY_PAYOUT: nằm trong lệnh rút ngân hàng cũ. ANONYMIZED: CTV đã xoá tài khoản (Ví đã về 0). PAYOUT_UNKNOWN: hoa hồng PAID cũ
   * không xác định được lệnh chuyển vào Ví đã chứa nó, nên không biết phần thực nhận (có thể đã bị giữ thuế TNCN) để trừ.
   */
  reason: 'LEGACY_PAYOUT' | 'ANONYMIZED' | 'PAYOUT_UNKNOWN';
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
  | { debited: true; applied: boolean; walletDebit: number; taxWithheld: number; balanceAfter: number }
  /** Không trừ Ví, kế toán xử lý tay: tài khoản CTV đã ẩn danh (Ví đã về 0), hoặc không xác định được lệnh chuyển gốc. */
  | { debited: false; reason: 'ANONYMIZED' | 'PAYOUT_UNKNOWN' };

type PayoutTax = { grossAmount: number | null; taxWithheld: number; taxRefunded: number };

/**
 * requestPayout chỉ cộng vào Ví phần thực nhận của lệnh chuyển (tổng hoa hồng trừ thuế TNCN thực giữ), nên hoa hồng bị thu hồi chỉ
 * trừ Ví theo đúng tỉ lệ đó: trừ cả số gộp thì CTV mất luôn phần thuế chưa bao giờ vào Ví. Chia theo tỉ lệ để mọi hoa hồng của một
 * lệnh bị thu hồi hết thì tổng đã trừ bằng đúng số lệnh đó đã cộng vào Ví (lệch tối đa vài đồng do làm tròn từng khoản).
 * `tax` là thuế thực giữ của lệnh (taxWithheld − taxRefunded; phần đã hoàn về Ví không còn là thuế).
 */
export function walletShareOfCommission(cut: number, payout: PayoutTax | null): { debit: number; tax: number } {
  const tax = payout ? Math.max(payout.taxWithheld - payout.taxRefunded, 0) : 0;
  const gross = payout?.grossAmount ?? 0;
  if (tax <= 0 || gross <= 0) return { debit: cut, tax: 0 };
  const taxShare = Math.min(cut, Math.round((cut * tax) / gross));
  return { debit: cut - taxShare, tax };
}

/**
 * Lệnh chuyển hoa hồng vào Ví đã chứa hoa hồng này. Hoa hồng chuyển từ bản có cột walletPayoutId thì tra thẳng; hoa hồng PAID cũ chưa
 * có cột thì lấy lệnh chuyển Ví gần nhất của CTV không muộn hơn lúc hoa hồng thành PAID (requestPayout tạo lệnh trước khi đánh dấu
 * PAID) và tổng hoa hồng của lệnh phải đủ chứa hoa hồng này. Lệnh cũ trước khi có khấu trừ thuế (grossAmount rỗng) cộng đủ vào Ví.
 * Không xác định được thì trả null: không đoán số tiền Ví đã nhận.
 */
async function payoutOfCommission(
  tx: Prisma.TransactionClient,
  c: { affiliateUserId: string; walletPayoutId: string | null; paidAt: Date | null },
  cut: number,
): Promise<PayoutTax | null> {
  const select = { grossAmount: true, taxWithheld: true, taxRefunded: true } as const;
  if (c.walletPayoutId) return tx.payout.findUnique({ where: { id: c.walletPayoutId }, select });
  if (!c.paidAt) return null;
  const payout = await tx.payout.findFirst({
    where: { userId: c.affiliateUserId, method: 'WALLET_BALANCE', status: { not: 'REJECTED' }, requestedAt: { lte: c.paidAt } },
    orderBy: { requestedAt: 'desc' },
    select,
  });
  if (payout && payout.grossAmount !== null && payout.grossAmount < cut) return null;
  return payout;
}

/**
 * Trừ Ví CTV phần hoa hồng bị thu hồi (số dư được phép âm). `amount` là phần hoa hồng bị thu hồi (số gộp); số trừ thật là phần
 * thực nhận của nó (walletShareOfCommission), bằng 0 thì không ghi dòng sổ. Không xác định được lệnh chuyển gốc thì không trừ (trả
 * PAYOUT_UNKNOWN). refId duy nhất cho mỗi lần thu hồi: id hoa hồng cho lần trả cả đơn, `<id hoa hồng>:<id yêu cầu trả>` cho từng lần
 * trả một phần, nên chạy lại không trừ hai lần. Đọc cờ ẩn danh và trừ là một bước dưới cùng khoá dòng user (cùng cách
 * creditWalletUnlessAnonymized).
 */
export async function debitCommissionFromWallet(
  tx: Prisma.TransactionClient,
  input: {
    commission: { id: string; affiliateUserId: string; walletPayoutId: string | null; paidAt: Date | null };
    amount: number;
    refId: string;
    reason: string;
  },
): Promise<CommissionDebitResult> {
  const userId = input.commission.affiliateUserId;
  const rows = await tx.$queryRaw<{ metadata: unknown; walletBalance: number }[]>`SELECT "metadata", "walletBalance" FROM "users" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
  if (anonymizedAtOf(rows?.[0]?.metadata)) return { debited: false, reason: 'ANONYMIZED' };
  const payout = await payoutOfCommission(tx, input.commission, input.amount);
  if (!payout) return { debited: false, reason: 'PAYOUT_UNKNOWN' };
  const { debit, tax } = walletShareOfCommission(input.amount, payout);
  if (debit <= 0) return { debited: true, applied: true, walletDebit: 0, taxWithheld: tax, balanceAfter: rows?.[0]?.walletBalance ?? 0 };
  const res = await applyWalletDelta(tx, {
    userId,
    delta: -debit,
    type: 'COMMISSION_REVERSAL',
    refType: 'COMMISSION',
    refId: input.refId,
    reason: input.reason,
    allowNegative: true,
  });
  return { debited: true, applied: res.applied, walletDebit: debit, taxWithheld: tax, balanceAfter: res.balanceAfter };
}
