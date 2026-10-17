import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * "Khách mới" cho ưu đãi đơn đầu (mã `newCustomerOnly`, miễn phí giao đơn đầu): tài khoản chưa có đơn nào ngoài đơn đã
 * huỷ. Đơn chờ thanh toán, đang xử lý, đang giao, đã giao và đã trả hàng đều tính: khách đã mua, và đơn trả hàng tính để
 * không mua rồi trả để lấy lại ưu đãi đơn đầu. Đơn chờ thanh toán quá hạn bị cron huỷ thì thôi tính. Đơn của phiên khách
 * vãng lai đã sang tài khoản đích khi gộp (auth.service mergeGuestInto), nên đếm theo userId là đã gồm chúng.
 */
export const FIRST_ORDER_LOCK = 'first-order';

/** Các đơn của chính lần đặt đang ghi trong transaction (đơn đầu nhóm và các đơn tách theo nơi giao). */
export interface OwnCheckout {
  orderIds?: string[];
  checkoutGroup?: string | null;
}

export function priorOrderWhere(userId: string, own: OwnCheckout = {}): Prisma.OrderWhereInput {
  return {
    userId,
    status: { not: 'CANCELLED' },
    ...(own.orderIds?.length ? { id: { notIn: own.orderIds } } : {}),
    ...(own.checkoutGroup ? { OR: [{ checkoutGroup: null }, { checkoutGroup: { not: own.checkoutGroup } }] } : {}),
  };
}

type OrderReader = { order: { findFirst(args: { where: Prisma.OrderWhereInput; select: { id: true } }): Promise<unknown> } };

export async function hasPriorOrder(db: OrderReader, userId: string, own: OwnCheckout = {}): Promise<boolean> {
  return (await db.order.findFirst({ where: priorOrderWhere(userId, own), select: { id: true } })) != null;
}

/**
 * Kiểm lại "đơn đầu" trong transaction đặt đơn. Khoá theo khách giữ tới hết transaction: lần đặt song song thứ hai chờ ở đây,
 * qua khoá thì đọc được đơn lần đầu đã ghi và bị từ chối (rollback cả đơn). Mọi chỗ khoá cả khoá này lẫn khoá (mã, khách) của
 * CouponsService.redeem đều lấy khoá này TRƯỚC, để hai lần đặt không giữ chéo khoá của nhau.
 */
export async function assertFirstOrderInTx(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'> & OrderReader,
  userId: string,
  own: OwnCheckout,
  message: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${FIRST_ORDER_LOCK}), hashtext(${userId}))`;
  if (await hasPriorOrder(tx, userId, own)) throw new BadRequestException(message);
}
