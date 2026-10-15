import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Đơn đại lý "Ghi công nợ": có dòng DealerCreditLedger refType=ORDER lúc đặt. Đơn này là BANK_TRANSFER + UNPAID suốt đời
 * (tiền đi qua sổ công nợ, không bao giờ qua nhận tiền) — mọi luồng tiền (đối soát chuyển khoản Pancake, hoàn khi huỷ) phải
 * nhận diện được nó để không trả hai lần: một lần qua công nợ, một lần qua Ví/hoàn tiền.
 */
export async function hasDealerCreditDebit(
  db: Pick<PrismaClient | Prisma.TransactionClient, 'dealerCreditLedger'>,
  order: { id: string; type: string },
): Promise<boolean> {
  if (order.type !== 'DEALER') return false;
  const debit = await db.dealerCreditLedger.findFirst({ where: { refType: 'ORDER', refId: order.id }, select: { id: true } });
  return debit !== null;
}
