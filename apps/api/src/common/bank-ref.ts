import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** `ref` đã viết thường: ghi chú lịch sử nối các phần bằng " · " nên khớp nguyên một phần, không khớp chuỗi con. */
export const noteHasBankRef = (note: string | null, ref: string) =>
  (note ?? '')
    .toLowerCase()
    .split(' · ')
    .some((part) => part.trim() === `mã gd ${ref}`);

/** Khoá advisory theo mã giao dịch, giữ tới hết transaction của `tx`: hai lời xác nhận song song cùng mã phải xếp hàng. */
export async function lockBankRef(tx: Prisma.TransactionClient, bankRef: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dealer-bankref:${bankRef.toLowerCase()}`}))`;
}

/** Mã giao dịch đã ghi ở một đơn bất kỳ (xác nhận đơn lẻ/đại lý hoặc khoản hoàn tiền về muộn; khác `exceptOrderId`): trả mã đơn, không có thì null. */
export async function findOrderUsingBankRef(db: Db, bankRef: string, exceptOrderId?: string) {
  const ref = bankRef.toLowerCase();
  const history = await db.orderStatusHistory.findMany({
    where: {
      note: { contains: `Mã GD ${bankRef}`, mode: 'insensitive' },
      actorType: 'ADMIN',
      ...(exceptOrderId ? { orderId: { not: exceptOrderId } } : {}),
    },
    select: { orderId: true, note: true },
  });
  // Khoản hoàn tiền về muộn chỉ giữ mã trong adminNote, không có dòng lịch sử đơn: tra thêm để cùng một mã không vừa xác nhận đơn vừa sinh khoản hoàn.
  const lateRefunds = await db.orderCustomerRefund.findMany({
    where: {
      kind: 'LATE_PAYMENT',
      adminNote: { contains: `Mã GD ${bankRef}`, mode: 'insensitive' },
      ...(exceptOrderId ? { orderId: { not: exceptOrderId } } : {}),
    },
    select: { orderId: true, adminNote: true },
  });
  const historyIds = history.filter((h) => noteHasBankRef(h.note, ref)).map((h) => h.orderId);
  const lateIds = lateRefunds.filter((r) => noteHasBankRef(r.adminNote, ref)).map((r) => r.orderId);
  // `late`: mã chỉ nằm ở khoản hoàn tiền về muộn của đơn đã đóng, đơn đó chưa từng được xác nhận thanh toán bằng mã này; ưu tiên báo đơn đã xác nhận.
  if (historyIds.length) {
    const confirmed = await db.order.findFirst({ where: { id: { in: historyIds } }, select: { code: true } });
    if (confirmed) return { code: confirmed.code, late: false };
  }
  if (!lateIds.length) return null;
  const closed = await db.order.findFirst({ where: { id: { in: lateIds } }, select: { code: true } });
  return closed ? { code: closed.code, late: true } : null;
}

/** Câu 409 khi mã đã gắn với một đơn: nói đúng việc mã đã làm, để người đối soát không tưởng đơn đã đóng được xác nhận thanh toán. */
export const bankRefUsedByOrderMessage = (bankRef: string, used: { code: string; late: boolean }) =>
  used.late
    ? `Mã giao dịch ${bankRef} đã ghi cho khoản tiền về muộn của đơn ${used.code} (đơn đã đóng). Kiểm tra lại mã hoặc bỏ trống ô mã.`
    : `Mã giao dịch ${bankRef} đã dùng để xác nhận đơn ${used.code}. Kiểm tra lại mã hoặc bỏ trống ô mã.`;

/** Mã giao dịch đã ghi giảm công nợ của bất kỳ đại lý nào (refId hoặc phần "Mã GD" trong ghi chú), trừ dòng có `own` (khoá của chính lần ghi này). */
export async function isBankRefOnPayment(db: Db, bankRef: string, own?: { userId: string; refId: string }) {
  const ref = bankRef.toLowerCase();
  const payments = await db.dealerCreditLedger.findMany({
    where: {
      refType: 'PAYMENT',
      OR: [{ refId: { equals: bankRef, mode: 'insensitive' } }, { note: { contains: `Mã GD ${bankRef}`, mode: 'insensitive' } }],
    },
    select: { userId: true, refId: true, note: true },
  });
  return payments.some(
    (p) => !(own && p.userId === own.userId && p.refId === own.refId) && (p.refId?.toLowerCase() === ref || noteHasBankRef(p.note, ref)),
  );
}

/**
 * Một khoản chuyển khoản chỉ xác nhận được MỘT lần: mã giao dịch (bỏ khoảng trắng, không phân biệt hoa thường) đã ghi ở đơn
 * khác (lẻ hay đại lý) hoặc ở một khoản trả nợ thì 409 kèm mã đơn đã dùng. Mã chỉ nằm trong ghi chú lịch sử nên không có ràng buộc DB;
 * khoá advisory theo mã giữ tới hết transaction của `tx`, nên bên gọi PHẢI chạy hàm này trong cùng transaction với lần ghi PAID.
 * Transaction Read Committed nên mỗi câu đọc thấy dữ liệu mới nhất sau khi chờ khoá.
 */
export async function assertBankRefUnusedByOrder(tx: Prisma.TransactionClient, bankRef: string, orderId: string) {
  await lockBankRef(tx, bankRef);
  const usedOrder = await findOrderUsingBankRef(tx, bankRef, orderId);
  if (usedOrder) {
    throw new ConflictException(bankRefUsedByOrderMessage(bankRef, usedOrder));
  }
  if (await isBankRefOnPayment(tx, bankRef)) {
    throw new ConflictException(`Mã giao dịch ${bankRef} đã dùng để ghi giảm công nợ đại lý. Kiểm tra lại mã hoặc bỏ trống ô mã.`);
  }
}
