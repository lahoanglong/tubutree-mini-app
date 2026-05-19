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
import { awardForOrder, reverseForOrder } from '../services/points.service';
import { awardCommissionForOrder, reverseCommissionForOrder } from '../services/affiliate.service';

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

// Đã giao thành công → cập nhật trạng thái + thông báo + tích điểm
async function handleDelivered(data: any) {
  const orderId = data.order_id?.toString();
  if (!orderId) return;

  const order = await prisma.orderRef.findUnique({ where: { pos_order_id: orderId } });
  if (order) {
    await prisma.orderRef.update({ where: { id: order.id }, data: { payment_status: 'COMPLETED' } });

    // Tích điểm + commission
    const total = Number(data.total_price ?? data.cod ?? 0);
    if (total > 0) {
      try { await awardForOrder(order.id, total); }
      catch (e: any) { console.error('[Webhook] Award points lỗi:', e.message); }
      try { await awardCommissionForOrder(order.id, total); }
      catch (e: any) { console.error('[Webhook] Award commission lỗi:', e.message); }
    }

    await createNotification(order.user_id, 'Đã giao thành công', `Đơn hàng #${orderId} đã giao. Hãy đánh giá nhé!`, 'ORDER');
  }
}

// Đã hủy → cập nhật trạng thái + thông báo + reverse điểm (nếu đã cộng)
async function handleCancelled(data: any) {
  const orderId = data.order_id?.toString();
  if (!orderId) return;

  const order = await prisma.orderRef.findUnique({ where: { pos_order_id: orderId } });
  if (order) {
    await prisma.orderRef.update({ where: { id: order.id }, data: { payment_status: 'CANCELLED' } });
    try { await reverseForOrder(order.id); }
    catch (e: any) { console.error('[Webhook] Reverse points lỗi:', e.message); }
    try { await reverseCommissionForOrder(order.id); }
    catch (e: any) {
      // Commission đã PAYOUT → ghi audit để admin xem
      console.error('[Webhook] Reverse commission lỗi:', e.message);
      await prisma.adminAuditLog.create({
        data: {
          admin_zalo_uid: 'SYSTEM',
          action: 'COMMISSION_REVERSE_FAILED_ON_WEBHOOK_CANCEL',
          target_type: 'USER',
          target_id: order.user_id,
          reason: `Webhook cancel order ${order.id} nhưng reverse commission fail: ${e.message}`,
          metadata: { pos_order_id: orderId, order_ref_id: order.id, error: e.message } as any,
        },
      }).catch(() => {});
    }
    await createNotification(order.user_id, 'Đơn hàng đã hủy', `Đơn hàng #${orderId} đã bị hủy. Lý do: ${data.reason || 'Không rõ'}`, 'ORDER');
  }
}
