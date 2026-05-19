import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../lib/prisma';
import { createPancakeOrder, getPancakeOrder, cancelPancakeOrder, getDefaultWarehouseId } from '../services/pancake.service';
import { createNotification } from './notification.controller';
import { redeemPoints, previewRedeem, reverseForOrder } from '../services/points.service';
import { consumeVoucher } from './voucher.controller';
import { priceOrderItems } from '../services/order-pricing.service';
import { reverseCommissionForOrder } from '../services/affiliate.service';

// Tolerance giữa client subtotal và server-recompute (do FE có thể làm tròn)
const SUBTOTAL_TOLERANCE_VND = 1000n;

export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      items, addressId, paymentMethod, notes,
      subtotal_vnd: clientSubtotalRaw, voucher_code, points_to_redeem,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item' });
    }
    if (items.length > 100) {
      return res.status(400).json({ error: 'Quá nhiều items (>100)' });
    }

    const address = await prisma.address.findFirst({ where: { id: addressId, user_id: userId } });
    if (!address) return res.status(400).json({ error: 'Invalid address' });

    // ===== SERVER-SIDE SUBTOTAL VERIFY (C1) =====
    // Fetch giá từ Pancake — không trust client.
    let priced;
    try {
      priced = await priceOrderItems(items);
    } catch (e: any) {
      return res.status(400).json({ error: 'PRICE_LOOKUP_FAILED', message: e.message });
    }
    const subtotalBig = priced.subtotal;
    if (subtotalBig <= 0n) return res.status(400).json({ error: 'INVALID_SUBTOTAL' });

    // So sánh với client subtotal (nếu FE gửi) — chỉ để cảnh báo tampering, không dùng cho tính toán
    if (clientSubtotalRaw != null && /^\d+$/.test(String(clientSubtotalRaw))) {
      const clientSubtotal = BigInt(clientSubtotalRaw);
      const diff = clientSubtotal > subtotalBig ? clientSubtotal - subtotalBig : subtotalBig - clientSubtotal;
      if (diff > SUBTOTAL_TOLERANCE_VND) {
        console.warn(`[order] subtotal mismatch user ${userId}: client=${clientSubtotal} server=${subtotalBig}`);
      }
    }

    // ===== PRE-VALIDATE voucher (sẽ re-validate trong tx) =====
    let voucherDiscount = 0n;
    if (voucher_code) {
      const v = await prisma.voucher.findUnique({ where: { code: String(voucher_code).toUpperCase() } });
      if (!v || !v.is_active) return res.status(400).json({ error: 'VOUCHER_INVALID' });
      // Inline preview discount để gửi qua Pancake (consume sẽ re-compute trong tx)
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

    // ===== PRE-VALIDATE points =====
    const ptsToRedeem = Number(points_to_redeem || 0);
    let pointsDiscount = 0n;
    if (ptsToRedeem > 0) {
      const subtotalNum = Number(subtotalBig);
      const preview = await previewRedeem(userId, ptsToRedeem, subtotalNum);
      if (!preview.valid) return res.status(400).json({ error: preview.error || 'POINTS_INVALID' });
      pointsDiscount = BigInt(preview.discount_vnd);
    }

    let totalDiscount = voucherDiscount + pointsDiscount;
    if (totalDiscount > subtotalBig) totalDiscount = subtotalBig;
    let finalTotal = subtotalBig - totalDiscount;
    // Pancake từ chối total = 0 → floor về 1 VND, điều chỉnh discount tương ứng
    if (finalTotal <= 0n) {
      finalTotal = 1n;
      totalDiscount = subtotalBig - 1n;
      if (pointsDiscount > totalDiscount) pointsDiscount = totalDiscount;
      voucherDiscount = totalDiscount - pointsDiscount;
    }

    // ===== GỌI PANCAKE =====
    // CHÚ Ý: Pancake API có thể KHÔNG honor `discount` / `total_price` fields trực tiếp.
    // Lần đầu chạy production, ADMIN PHẢI test 1 đơn với voucher để verify:
    //   1. Invoice Pancake hiển thị đúng giá đã giảm (không phải giá gốc)
    //   2. COD driver thu đúng số tiền finalTotal
    // Nếu Pancake không support → cần encode discount thành line item "Khuyến mãi -X VND"
    // hoặc bypass Pancake hoàn toàn khi totalDiscount > 0.
    // Mở rộng payload: gửi cả discount và total_discount_amount để tương thích nhiều biến thể API.
    const pancakeOrderData: any = {
      warehouse_id: getDefaultWarehouseId(),
      customer: {
        name: address.name,
        phone: address.phone,
        address: `${address.detail}, ${address.ward}, ${address.district}, ${address.province}`,
      },
      items: priced.items.map(i => ({
        product_id: i.pos_product_id,
        variant_id: i.variation_id,
        quantity: i.qty,
      })),
      notes: notes || (totalDiscount > 0n ? `Áp dụng giảm giá ${totalDiscount.toString()} VND` : ''),
      payment_method: paymentMethod,
      discount: Number(totalDiscount),
      total_discount_amount: Number(totalDiscount),
      total_price: Number(finalTotal),
    };

    if (totalDiscount > 0n) {
      console.info(`[order] Đơn có giảm giá ${totalDiscount} VND. Verify Pancake invoice phản ánh đúng.`);
    }

    const pancakeOrder = await createPancakeOrder(pancakeOrderData);
    const pancakeOrderId = pancakeOrder?.id?.toString();
    if (!pancakeOrderId) {
      return res.status(502).json({ error: 'PANCAKE_NO_ORDER_ID' });
    }

    // ===== ATOMIC TX (C2: compensating cancel nếu fail) =====
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const orderRef = await tx.orderRef.create({
          data: {
            user_id: userId,
            pos_order_id: pancakeOrderId,
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

        // Re-validate + consume voucher trong tx (row-lock)
        if (voucher_code) {
          const consumed = await consumeVoucher(tx, String(voucher_code).toUpperCase(), userId, subtotalBig, orderRef.id);
          // Đồng bộ OrderRef với discount thật từ consume (tránh divergence)
          if (consumed.discount_vnd !== voucherDiscount) {
            const newVoucher = consumed.discount_vnd;
            const newTotalDiscount = newVoucher + pointsDiscount > subtotalBig ? subtotalBig : newVoucher + pointsDiscount;
            await tx.orderRef.update({
              where: { id: orderRef.id },
              data: {
                voucher_discount_vnd: newVoucher,
                total_vnd: subtotalBig - newTotalDiscount,
              },
            });
          }
        }

        // Redeem points
        if (ptsToRedeem > 0) {
          await redeemPoints(tx, userId, ptsToRedeem, orderRef.id);
        }

        return orderRef;
      });
    } catch (txErr: any) {
      // Compensating cancel Pancake order (best-effort)
      console.error(`[order] tx failed sau Pancake order ${pancakeOrderId}, attempting cancel:`, txErr.message);
      try {
        await cancelPancakeOrder(pancakeOrderId, 'Local tx rollback');
        console.log(`[order] Pancake order ${pancakeOrderId} đã cancel sau tx fail`);
      } catch (cancelErr: any) {
        // Ghi vào audit log để ops alert
        console.error(`[order] CRITICAL: Pancake order ${pancakeOrderId} mồ côi — cancel fail:`, cancelErr.message);
        try {
          await prisma.adminAuditLog.create({
            data: {
              admin_zalo_uid: 'SYSTEM',
              action: 'PANCAKE_ORPHAN',
              target_type: 'USER',
              target_id: userId,
              reason: `Pancake order ${pancakeOrderId} mồ côi, cancel cũng fail: ${cancelErr.message}`,
              metadata: { pancake_order_id: pancakeOrderId, tx_error: txErr.message } as any,
            },
          });
        } catch {}
      }
      if (typeof txErr.message === 'string' && txErr.message.startsWith('VOUCHER_')) {
        return res.status(409).json({ error: txErr.message, message: 'Voucher đã hết lượt hoặc bị consume bởi user khác.' });
      }
      if (typeof txErr.message === 'string' && txErr.message.startsWith('Không đủ điểm')) {
        return res.status(409).json({ error: 'POINTS_INSUFFICIENT', message: txErr.message });
      }
      return res.status(500).json({ error: 'ORDER_TX_FAILED', message: 'Đã huỷ đơn trên POS. Vui lòng thử lại.' });
    }

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
    const orderRef = await prisma.orderRef.findFirst({ where: { pos_order_id: id, user_id: userId } });
    if (!orderRef) return res.status(404).json({ error: 'Order not found' });
    const posOrder = await getPancakeOrder(id);
    res.status(200).json({ db_ref: serializeOrder(orderRef), pos_data: posOrder });
  } catch (error: any) {
    console.error('Error fetching order detail:', error.message);
    res.status(500).json({ error: 'Failed to fetch order detail' });
  }
};

// Pancake statuses tương ứng "đơn đã giao" — không cho user cancel
const POS_DELIVERED_STATUSES = new Set(['delivered', 'completed', 'shipping', 'shipped', 'returning']);

export const cancelOrder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { reason } = req.body;

    const orderRef = await prisma.orderRef.findFirst({ where: { pos_order_id: id, user_id: userId } });
    if (!orderRef) return res.status(404).json({ error: 'Order not found' });
    if (orderRef.payment_status === 'CANCELLED') {
      return res.status(400).json({ error: 'Order is already cancelled' });
    }
    if (orderRef.payment_status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot cancel a completed order' });
    }

    // C5: Check trạng thái thực tế trên Pancake (tránh huỷ đơn đã giao mà webhook chưa về)
    try {
      const posOrder = await getPancakeOrder(id);
      const posStatus = String(posOrder?.data?.status || posOrder?.status || '').toLowerCase();
      if (POS_DELIVERED_STATUSES.has(posStatus)) {
        return res.status(409).json({
          error: 'POS_ALREADY_FULFILLED',
          message: 'Đơn đã giao/đang giao trên hệ thống POS, không thể huỷ.',
          pos_status: posStatus,
        });
      }
    } catch (e: any) {
      console.warn('[order] Không check được Pancake status:', e.message);
      // Vẫn cho cancel — fall through
    }

    // C4: Reverse + status update trong cùng tx-ish. Reverse có thể throw COMMISSION_ALREADY_PAID_OUT.
    // Pancake cancel trước (vì không rollback được nếu đã chuyển khoản hoa hồng).
    await cancelPancakeOrder(id, reason || 'Khách yêu cầu hủy');

    try {
      await reverseForOrder(orderRef.id);
      await reverseCommissionForOrder(orderRef.id);
    } catch (reverseErr: any) {
      // Commission đã rút → không thể reverse ledger an toàn.
      // Đơn đã cancel trên Pancake, mình ghi audit + tạm để payment_status nguyên rồi alert admin.
      console.error(`[order] CRITICAL: reverse fail order ${id}:`, reverseErr.message);
      await prisma.adminAuditLog.create({
        data: {
          admin_zalo_uid: 'SYSTEM',
          action: 'REVERSE_FAILED_ON_CANCEL',
          target_type: 'USER',
          target_id: userId,
          reason: `Order ${id} cancel trên Pancake nhưng reverse fail: ${reverseErr.message}`,
          metadata: { pos_order_id: id, order_ref_id: orderRef.id, error: reverseErr.message } as any,
        },
      });
      // Không update payment_status — để admin review
      return res.status(409).json({
        error: 'REVERSE_FAILED',
        message: 'Đã huỷ trên POS nhưng cần admin xem lại do hoa hồng đã được rút. Liên hệ admin.',
      });
    }

    await prisma.orderRef.update({
      where: { id: orderRef.id },
      data: { payment_status: 'CANCELLED' },
    });

    await createNotification(userId, 'Đơn hàng đã hủy', `Đơn hàng #${id} đã được hủy thành công.`, 'ORDER');
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
