import { Prisma, type CommissionStatus } from '@prisma/client';
import { vnMonthBounds } from '../affiliate/ctv-milestones';
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

/** Một khoản hoa hồng đã vào Ví CTV bị thu hồi khi đơn bị trả/huỷ. */
export interface CommissionDebitNote {
  affiliateUserId: string;
  /** Hoa hồng bị thu hồi (số gộp). */
  amount: number;
  /** Số đã trừ khỏi Ví: phần thực nhận của `amount`, vì lệnh chuyển gốc chỉ cộng vào Ví sau khi giữ thuế TNCN. 0 thì không có dòng sổ. */
  walletDebit: number;
  /** Phần thuế TNCN của lệnh chuyển gốc ứng với riêng khoản này (amount − walletDebit). */
  taxShare: number;
  /** Lệnh chuyển vào Ví đã chứa hoa hồng này và tổng thuế TNCN thực giữ của cả lệnh. */
  payoutId: string;
  payoutTax: number;
  /**
   * Lệnh có grossAmount: báo cáo thuế (pitReport, taxStatement) và mức giữ thuế của các lệnh sau trong tháng (personalIncomeTax) đã
   * tính khoản này là thu nhập tháng `incomeMonth` (YYYY-MM giờ VN theo lúc chi), dù nay đã thu hồi. Lệnh cũ không có grossAmount
   * không nằm trong báo cáo đó.
   */
  incomeDeclared: boolean;
  incomeMonth: string;
  /** < 0: Ví CTV đang âm. */
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
  | { debited: true; applied: boolean; note: CommissionDebitNote }
  /** Không trừ Ví, kế toán xử lý tay: tài khoản CTV đã ẩn danh (Ví đã về 0), hoặc không xác định được lệnh chuyển gốc. */
  | { debited: false; reason: 'ANONYMIZED' | 'PAYOUT_UNKNOWN' };

type PayoutTax = { grossAmount: number | null; taxWithheld: number; taxRefunded: number };

/**
 * requestPayout chỉ cộng vào Ví phần thực nhận của lệnh chuyển (tổng hoa hồng trừ thuế TNCN thực giữ), nên hoa hồng bị thu hồi chỉ
 * trừ Ví theo đúng tỉ lệ đó: trừ cả số gộp thì CTV mất luôn phần thuế chưa bao giờ vào Ví. Phần thuế của khoản làm tròn lên (phần
 * trừ Ví làm tròn xuống) để mỗi lần trừ không vượt phần khoản đó đã nhận: thu hồi hết các hoa hồng của một lệnh, kể cả cắt nhiều lần,
 * không bao giờ trừ quá số lệnh đó đã cộng vào Ví. `tax` là thuế thực giữ của cả lệnh (taxWithheld − taxRefunded; phần đã hoàn về Ví
 * không còn là thuế), `taxShare` là phần của riêng khoản này.
 */
export function walletShareOfCommission(cut: number, payout: PayoutTax | null): { debit: number; taxShare: number; tax: number } {
  const tax = payout ? Math.max(payout.taxWithheld - payout.taxRefunded, 0) : 0;
  const gross = payout?.grossAmount ?? 0;
  if (tax <= 0 || gross <= 0) return { debit: cut, taxShare: 0, tax: 0 };
  const taxShare = Math.min(cut, Math.ceil((cut * tax) / gross));
  return { debit: cut - taxShare, taxShare, tax };
}

type SourcePayout = PayoutTax & { id: string; paidAt: Date | null; requestedAt: Date };

/**
 * Lệnh chuyển hoa hồng vào Ví đã chứa hoa hồng này. Hoa hồng chuyển từ bản có cột walletPayoutId thì tra thẳng. Hoa hồng PAID cũ chưa
 * có cột thì lấy lệnh chuyển Ví gần nhất của CTV tạo không muộn hơn và chi không sớm hơn lúc hoa hồng thành PAID (requestPayout tạo
 * mốc requestedAt, đánh dấu PAID rồi mới ghi lệnh với paidAt), và tổng hoa hồng của lệnh phải đủ chứa hoa hồng này. Lệnh cũ trước khi
 * có khấu trừ thuế (grossAmount rỗng) cộng đủ vào Ví. Không xác định được thì trả null: không đoán số tiền Ví đã nhận.
 */
async function payoutOfCommission(
  tx: Prisma.TransactionClient,
  c: { affiliateUserId: string; walletPayoutId: string | null; paidAt: Date | null },
  cut: number,
): Promise<SourcePayout | null> {
  const select = { id: true, grossAmount: true, taxWithheld: true, taxRefunded: true, paidAt: true, requestedAt: true } as const;
  if (c.walletPayoutId) return tx.payout.findUnique({ where: { id: c.walletPayoutId }, select });
  if (!c.paidAt) return null;
  const payout = await tx.payout.findFirst({
    where: {
      userId: c.affiliateUserId,
      method: 'WALLET_BALANCE',
      status: { not: 'REJECTED' },
      requestedAt: { lte: c.paidAt },
      paidAt: { gte: c.paidAt },
    },
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
  const { debit, taxShare, tax } = walletShareOfCommission(input.amount, payout);
  const note = (balanceAfter: number): CommissionDebitNote => ({
    affiliateUserId: userId,
    amount: input.amount,
    walletDebit: debit,
    taxShare,
    payoutId: payout.id,
    payoutTax: tax,
    incomeDeclared: payout.grossAmount !== null,
    incomeMonth: vnMonthBounds(payout.paidAt ?? payout.requestedAt).key,
    balanceAfter,
  });
  if (debit <= 0) return { debited: true, applied: true, note: note(rows?.[0]?.walletBalance ?? 0) };
  const res = await applyWalletDelta(tx, {
    userId,
    delta: -debit,
    type: 'COMMISSION_REVERSAL',
    refType: 'COMMISSION',
    refId: input.refId,
    reason: input.reason,
    allowNegative: true,
  });
  return { debited: true, applied: res.applied, note: note(res.balanceAfter) };
}
