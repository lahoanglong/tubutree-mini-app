/**
 * Webhook Controller - Nhận cập nhật từ Pancake POS
 *
 * Khi POS thay đổi trạng thái đơn hàng (xác nhận, đang giao, đã giao, hủy),
 * POS sẽ gọi webhook này để đồng bộ trạng thái.
 *
 * POST /api/webhook/pancake
 *
 * Các sự kiện (event):
 * - order.confirmed → Đơn đã xác nhận
 * - order.shipping  → Đang vận chuyển
 * - order.delivered  → Đã giao thành công
 * - order.cancelled  → Đã hủy
 */
import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { createNotification } from './notification.controller';

export const handlePancakeWebhook = async (req: Request, res: Response) => {
  try {
    const { event, data } = req.body;
    console.log(`[Webhook] Sự kiện: ${event}`);

    // Xử lý từng loại sự kiện
    switch (event) {
      case 'order.confirmed':
        await notifyUser(data, 'Đơn hàng đã xác nhận', 'đã được xác nhận và đang chuẩn bị');
        break;
      case 'order.shipping':
        await notifyUser(data, 'Đơn hàng đang giao', 'đang được vận chuyển đến bạn');
        break;
      case 'order.delivered':
        await handleDelivered(data);
        break;
      case 'order.cancelled':
        await handleCancelled(data);
        break;
      default:
        console.log(`[Webhook] Sự kiện chưa xử lý: ${event}`);
    }

    // Luôn trả 200 để POS không gửi lại
    res.json({ received: true });
  } catch (error: any) {
    console.error('[Webhook] Lỗi:', error.message);
    res.json({ received: true, error: error.message });
  }
};

// === HÀM NỘI BỘ ===

// Gửi thông báo cho user khi đơn hàng thay đổi trạng thái
async function notifyUser(data: any, title: string, statusText: string) {
  const orderId = data.order_id?.toString();
  if (!orderId) return;

  const order = await prisma.orderRef.findUnique({ where: { pos_order_id: orderId } });
  if (order) {
    await createNotification(order.user_id, title, `Đơn hàng #${orderId} ${statusText}.`, 'ORDER');
  }
}

// Đã giao thành công → cập nhật trạng thái + thông báo
async function handleDelivered(data: any) {
  const orderId = data.order_id?.toString();
  if (!orderId) return;

  const order = await prisma.orderRef.findUnique({ where: { pos_order_id: orderId } });
  if (order) {
    await prisma.orderRef.update({ where: { id: order.id }, data: { payment_status: 'COMPLETED' } });
    await createNotification(order.user_id, 'Đã giao thành công', `Đơn hàng #${orderId} đã giao. Hãy đánh giá nhé!`, 'ORDER');
  }
}

// Đã hủy → cập nhật trạng thái + thông báo
async function handleCancelled(data: any) {
  const orderId = data.order_id?.toString();
  if (!orderId) return;

  const order = await prisma.orderRef.findUnique({ where: { pos_order_id: orderId } });
  if (order) {
    await prisma.orderRef.update({ where: { id: order.id }, data: { payment_status: 'CANCELLED' } });
    await createNotification(order.user_id, 'Đơn hàng đã hủy', `Đơn hàng #${orderId} đã bị hủy. Lý do: ${data.reason || 'Không rõ'}`, 'ORDER');
  }
}
