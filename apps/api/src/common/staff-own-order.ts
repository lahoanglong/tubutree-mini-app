import { toLocalPhone } from './phone';

/**
 * Đơn "của chính nhân viên": đặt bằng tài khoản của họ, hoặc đơn CTV đặt hộ mà SĐT khách cuối / người nhận trùng SĐT của họ.
 * Chỉ so userId thì kế toán nhờ CTV đặt hộ bằng SĐT mình để tự xác nhận tiền.
 */
export async function isStaffOwnOrder(
  prisma: { user: { findUnique: (a: { where: { id: string }; select: { phone: true } }) => Promise<{ phone: string | null } | null> } },
  actorId: string,
  order: { userId: string | null; endCustomerKey?: string | null; shippingAddress?: unknown },
): Promise<boolean> {
  if (order.userId === actorId) return true;
  const addr = order.shippingAddress && typeof order.shippingAddress === 'object' ? (order.shippingAddress as { phone?: unknown }) : null;
  const phones = [order.endCustomerKey, typeof addr?.phone === 'string' ? addr.phone : null].filter((p): p is string => !!p);
  if (phones.length === 0) return false;
  const me = await prisma.user.findUnique({ where: { id: actorId }, select: { phone: true } });
  const mine = me?.phone ? toLocalPhone(me.phone) : null;
  return !!mine && phones.some((p) => toLocalPhone(p) === mine);
}
