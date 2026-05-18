import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { PrismaClient } from '@prisma/client';
import { createPancakeOrder, getPancakeOrder, cancelPancakeOrder } from '../services/pancake.service';
import { createNotification } from './notification.controller';

const prisma = new PrismaClient();

export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { items, addressId, paymentMethod, notes } = req.body;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item' });
    }

    // Get user address
    const address = await prisma.address.findFirst({
      where: { id: addressId, user_id: userId }
    });

    if (!address) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    // Format data for Pancake API
    const pancakeOrderData = {
      customer: {
        name: address.name,
        phone: address.phone,
        address: `${address.detail}, ${address.ward}, ${address.district}, ${address.province}`
      },
      items: items.map((item: any) => ({
        product_id: item.pos_product_id,
        variant_id: item.variant_id,
        quantity: item.qty
      })),
      notes: notes || '',
      payment_method: paymentMethod
    };

    // Call Pancake API to create order
    const pancakeOrder = await createPancakeOrder(pancakeOrderData);

    // Save order ref in PostgreSQL
    const orderRef = await prisma.orderRef.create({
      data: {
        user_id: userId,
        pos_order_id: pancakeOrder.id.toString(),
        payment_method: paymentMethod,
        payment_status: paymentMethod === 'COD' ? 'PENDING' : 'WAITING_PAYMENT'
      }
    });

    res.status(201).json({
      success: true,
      order: orderRef,
      pos_data: pancakeOrder
    });
  } catch (error: any) {
    console.error('Error creating order:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create order' });
  }
};

export const getMyOrders = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    
    const orders = await prisma.orderRef.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' }
    });

    // In a real scenario, we might want to fetch latest statuses from POS
    // Here we return DB refs, and FE can call detail API for specific POS info
    
    res.status(200).json(orders);
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
      where: { pos_order_id: id, user_id: userId }
    });

    if (!orderRef) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const posOrder = await getPancakeOrder(id);

    res.status(200).json({
      db_ref: orderRef,
      pos_data: posOrder
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
      where: { pos_order_id: id, user_id: userId }
    });

    if (!orderRef) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (orderRef.payment_status === 'CANCELLED') {
      return res.status(400).json({ error: 'Order is already cancelled' });
    }

    if (orderRef.payment_status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot cancel a completed order' });
    }

    // Call POS to cancel
    await cancelPancakeOrder(id, reason || 'Khách yêu cầu hủy');

    // Update local status
    await prisma.orderRef.update({
      where: { id: orderRef.id },
      data: { payment_status: 'CANCELLED' }
    });

    await createNotification(
      userId,
      'Đơn hàng đã hủy',
      `Đơn hàng #${id} đã được hủy thành công.`,
      'ORDER'
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

    // Get the POS order to extract items
    const posOrder = await getPancakeOrder(id);

    if (!posOrder || !posOrder.items) {
      return res.status(404).json({ error: 'Original order not found or has no items' });
    }

    // Add items to cart
    for (const item of posOrder.items) {
      const existingCartItem = await prisma.cartItem.findUnique({
        where: {
          user_id_pos_product_id_variant_id: {
            user_id: userId,
            pos_product_id: item.product_id?.toString(),
            variant_id: item.variant_id?.toString() || null
          }
        }
      });

      if (existingCartItem) {
        await prisma.cartItem.update({
          where: { id: existingCartItem.id },
          data: { qty: existingCartItem.qty + (item.quantity || 1) }
        });
      } else {
        await prisma.cartItem.create({
          data: {
            user_id: userId,
            pos_product_id: item.product_id?.toString(),
            variant_id: item.variant_id?.toString() || null,
            qty: item.quantity || 1
          }
        });
      }
    }

    res.status(200).json({ message: 'Items added to cart from previous order' });
  } catch (error: any) {
    console.error('Error reordering:', error.message);
    res.status(500).json({ error: 'Failed to reorder' });
  }
};
