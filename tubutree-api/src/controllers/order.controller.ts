import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../lib/prisma';
import { createPancakeOrder, getPancakeOrder, cancelPancakeOrder } from '../services/pancake.service';
import { createNotification } from './notification.controller';
import { redeemPoints, previewRedeem } from '../services/points.service';
import { consumeVoucher } from './voucher.controller';

export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      items, addressId, paymentMethod, notes,
      subtotal_vnd, voucher_code, points_to_redeem,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item' });
    }
    if (subtotal_vnd == null || !/^\d+$/.test(String(subtotal_vnd))) {
      return res.status(400).json({ error: 'subtotal_vnd phải là số nguyên dương' });
    }
    const subtotalBig = BigInt(subtotal_vnd);
    if (subtotalBig <= 0n) {
      return res.status(400).json({ error: 'subtotal_vnd phải > 0' });
    }

    const address = await prisma.address.findFirst({
      where: { id: addressId, user_id: userId },
    });
    if (!address) return res.status(400).json({ error: 'Invalid address' });

    // ===== PRE-VALIDATE discount sources (trước khi gọi Pancake) =====
    let voucherDiscount = 0n;
    let voucherIdReserved: number | null = null;
    if (voucher_code) {
      // Re-validate ngoài tx — error sớm trước khi gọi Pancake
      const v = await prisma.voucher.findUnique({ where: { code: String(voucher_code).toUpperCase() } });
      if (!v || !v.is_active) return res.status(400).json({ error: 'VOUCHER_INVALID' });
      voucherIdReserved = v.id;
    }

    const ptsToRedeem = Number(points_to_redeem || 0);
    let pointsDiscount = 0n;
    if (ptsToRedeem > 0) {
      const subtotalNum = Number(subtotalBig); // safe: VN VND << 2^53
      const preview = await previewRedeem(userId, ptsToRedeem, subtotalNum);
      if (!preview.valid) return res.status(400).json({ error: preview.error || 'POINTS_INVALID' });
      pointsDiscount = BigInt(preview.discount_vnd);
    }

    // Tổng discount tạm (chưa consume voucher — sẽ consume trong tx sau khi Pancake OK)
    // Cần compute trước để gửi vào Pancake.
    // Discount = voucher + points, nhưng voucher discount phụ thuộc vào subtotal-after-points hay không?
    // Decision: voucher tính trên subtotal gốc (đơn giản, dễ hiểu). Points tính trên subtotal gốc luôn.
    // Stacking: cho phép cộng dồn nhưng đảm bảo total >= 0.
    // Voucher discount preview (chính xác sẽ re-compute trong tx)
    if (voucher_code && voucherIdReserved != null) {
      const v = await prisma.voucher.findUnique({ where: { id: voucherIdReserved } });
      if (v) {
        // Inline compute - identical to computeVoucherDiscount
        if (v.type === 'PERCENT') {
          const pct = v.percent_value ?? v.value;
          const scaled = BigInt(Math.round(pct * 100));
          let d = (subtotalBig * scaled) / 10000n;
          if (v.max_discount_vnd != null && d > v.max_discount_vnd) d = v.max_discount_vnd;
          voucherDiscount = d;
        } else if (v.type === 'FIXED') {
          const fixed = v.fixed_amount_vnd ?? BigInt(Math.floor(v.value));
          voucherDiscount = fixed > subtotalBig ? subtotalBig : fixed;
        }
      }
    }

    let totalDiscount = voucherDiscount + pointsDiscount;
    if (totalDiscount > subtotalBig) totalDiscount = subtotalBig;
    const finalTotal = subtotalBig - totalDiscount;

    // ===== GỌI PANCAKE =====
    const pancakeOrderData: any = {
      customer: {
        name: address.name,
        phone: address.phone,
        address: `${address.detail}, ${address.ward}, ${address.district}, ${address.province}`,
      },
      items: items.map((item: any) => ({
        product_id: item.pos_product_id,
        variant_id: item.variant_id,
        quantity: item.qty,
      })),
      notes: notes || '',
      payment_method: paymentMethod,
      // Pancake có thể hoặc không support `discount` — pass through nếu có
      discount: Number(totalDiscount),
      total_price: Number(finalTotal),
    };

    const pancakeOrder = await createPancakeOrder(pancakeOrderData);

    // ===== ATOMIC TRANSACTION: tạo OrderRef + ledger entries =====
    const result = await prisma.$transaction(async (tx) => {
      const orderRef = await tx.orderRef.create({
        data: {
          user_id: userId,
          pos_order_id: pancakeOrder.id.toString(),
          payment_method: paymentMethod,
          payment_status: paymentMethod === 'COD' ? 'PENDING' : 'WAITING_PAYMENT',
          subtotal_vnd: subtotalBig,
          voucher_code: voucher_code ? String(voucher_code).toUpperCase() : null,
          voucher_discount_vnd: voucherDiscount,
          points_redeemed: ptsToRedeem,
          points_discount_vnd: pointsDiscount,
          total_vnd: finalTotal,
        },
      });

      // Consume voucher (re-validate trong tx)
      if (voucher_code) {
        await consumeVoucher(tx, String(voucher_code).toUpperCase(), userId, subtotalBig, orderRef.id);
      }

      // Redeem points
      if (ptsToRedeem > 0) {
        await redeemPoints(tx, userId, ptsToRedeem, orderRef.id);
      }

      return orderRef;
    });

    res.status(201).json({
      success: true,
      order: serializeOrder(result),
      pos_data: pancakeOrder,
      discount_summary: {
        subtotal_vnd: subtotalBig.toString(),
        voucher_discount_vnd: voucherDiscount.toString(),
        points_discount_vnd: pointsDiscount.toString(),
        total_vnd: finalTotal.toString(),
      },
    });
  } catch (error: any) {
    console.error('Error creating order:', error.response?.data || error.message);
    // Voucher hoặc points lỗi (post-Pancake) → đơn đã tạo trên Pancake nhưng tx rollback.
    // Đây là edge case rất hiếm vì đã pre-validate. Log để alert.
    if (typeof error.message === 'string' && error.message.startsWith('VOUCHER_')) {
      return res.status(409).json({ error: error.message, message: 'Voucher đã bị consume trước hoặc trạng thái thay đổi. Liên hệ hỗ trợ.' });
    }
    res.status(500).json({ error: 'Failed to create order' });
  }
};

function serializeOrder(o: any) {
  return {
    ...o,
    subtotal_vnd: o.subtotal_vnd.toString(),
    voucher_discount_vnd: o.voucher_discount_vnd.toString(),
    points_discount_vnd: o.points_discount_vnd.toString(),
    total_vnd: o.total_vnd.toString(),
  };
}

export const getMyOrders = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const orders = await prisma.orderRef.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    res.status(200).json(orders.map(serializeOrder));
  } catch (error: any) {
    console.error('Error fetching orders:', error.message);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

export const getOrderDetail = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const orderRef = await prisma.orderRef.findFirst({
      where: { pos_order_id: id, user_id: userId },
    });

    if (!orderRef) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const posOrder = await getPancakeOrder(id);

    res.status(200).json({
      db_ref: serializeOrder(orderRef),
      pos_data: posOrder,
    });
  } catch (error: any) {
    console.error('Error fetching order detail:', error.message);
    res.status(500).json({ error: 'Failed to fetch order detail' });
  }
};

export const cancelOrder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { reason } = req.body;

    const orderRef = await prisma.orderRef.findFirst({
      where: { pos_order_id: id, user_id: userId },
    });
    if (!orderRef) return res.status(404).json({ error: 'Order not found' });
    if (orderRef.payment_status === 'CANCELLED') {
      return res.status(400).json({ error: 'Order is already cancelled' });
    }
    if (orderRef.payment_status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot cancel a completed order' });
    }

    await cancelPancakeOrder(id, reason || 'Khách yêu cầu hủy');

    await prisma.orderRef.update({
      where: { id: orderRef.id },
      data: { payment_status: 'CANCELLED' },
    });

    // Reverse points (nếu đã EARN hoặc REDEEM) + commission được xử lý bởi webhook order.cancelled.
    // Ở đây user cancel chủ động — không có webhook → tự reverse.
    try {
      const { reverseForOrder } = await import('../services/points.service');
      const { reverseCommissionForOrder } = await import('../services/affiliate.service');
      await reverseForOrder(orderRef.id);
      await reverseCommissionForOrder(orderRef.id);
    } catch (e: any) {
      console.error('Reverse on user-cancel lỗi:', e.message);
    }

    await createNotification(
      userId,
      'Đơn hàng đã hủy',
      `Đơn hàng #${id} đã được hủy thành công.`,
      'ORDER',
    );

    res.status(200).json({ message: 'Order cancelled successfully' });
  } catch (error: any) {
    console.error('Error cancelling order:', error.message);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
};

export const reorder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const posOrder = await getPancakeOrder(id);

    if (!posOrder || !posOrder.items) {
      return res.status(404).json({ error: 'Original order not found or has no items' });
    }

    for (const item of posOrder.items) {
      const existingCartItem = await prisma.cartItem.findUnique({
        where: {
          user_id_pos_product_id_variant_id: {
            user_id: userId,
            pos_product_id: item.product_id?.toString(),
            variant_id: item.variant_id?.toString() || null,
          },
        },
      });

      if (existingCartItem) {
        await prisma.cartItem.update({
          where: { id: existingCartItem.id },
          data: { qty: existingCartItem.qty + (item.quantity || 1) },
        });
      } else {
        await prisma.cartItem.create({
          data: {
            user_id: userId,
            pos_product_id: item.product_id?.toString(),
            variant_id: item.variant_id?.toString() || null,
            qty: item.quantity || 1,
          },
        });
      }
    }

    res.status(200).json({ message: 'Items added to cart from previous order' });
  } catch (error: any) {
    console.error('Error reordering:', error.message);
    res.status(500).json({ error: 'Failed to reorder' });
  }
};
