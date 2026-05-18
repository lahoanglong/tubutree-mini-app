/**
 * Cart Controller - Giỏ hàng
 *
 * Giỏ hàng lưu trong database (bảng CartItem).
 * Mỗi item gồm: mã sản phẩm POS + biến thể + số lượng.
 *
 * 4 API:
 * - GET    /cart       → Xem giỏ hàng
 * - POST   /cart       → Thêm sản phẩm vào giỏ
 * - PUT    /cart/:id   → Cập nhật số lượng
 * - DELETE /cart/:id   → Xóa khỏi giỏ
 */
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../lib/prisma';
import { getUserId, handleError, toInt } from '../lib/helpers';

// Xem giỏ hàng
export const getCart = async (req: AuthRequest, res: Response) => {
  try {
    const items = await prisma.cartItem.findMany({
      where: { user_id: getUserId(req) },
    });
    res.json(items);
  } catch (error: any) {
    handleError(res, 'Lỗi lấy giỏ hàng', error);
  }
};

// Thêm sản phẩm vào giỏ
export const addToCart = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { pos_product_id, variant_id, qty } = req.body;

    if (!pos_product_id || !qty) {
      return res.status(400).json({ error: 'Cần có mã sản phẩm và số lượng' });
    }

    // Nếu sản phẩm đã có trong giỏ → cộng thêm số lượng
    const existing = await prisma.cartItem.findUnique({
      where: {
        user_id_pos_product_id_variant_id: {
          user_id: userId,
          pos_product_id,
          variant_id: variant_id || null,
        },
      },
    });

    let item;
    if (existing) {
      item = await prisma.cartItem.update({
        where: { id: existing.id },
        data: { qty: existing.qty + qty },
      });
    } else {
      item = await prisma.cartItem.create({
        data: { user_id: userId, pos_product_id, variant_id: variant_id || null, qty },
      });
    }

    res.json(item);
  } catch (error: any) {
    handleError(res, 'Lỗi thêm vào giỏ', error);
  }
};

// Cập nhật số lượng (nếu qty <= 0 thì xóa luôn)
export const updateCartItem = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const itemId = toInt(req.params.id);
    const { qty } = req.body;

    // Kiểm tra item có thuộc về user này không
    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, user_id: userId },
    });

    if (!item) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm trong giỏ' });
    }

    // Số lượng <= 0 → xóa khỏi giỏ
    if (qty <= 0) {
      await prisma.cartItem.delete({ where: { id: itemId } });
      return res.json({ message: 'Đã xóa khỏi giỏ hàng' });
    }

    const updated = await prisma.cartItem.update({
      where: { id: itemId },
      data: { qty },
    });

    res.json(updated);
  } catch (error: any) {
    handleError(res, 'Lỗi cập nhật giỏ hàng', error);
  }
};

// Xóa sản phẩm khỏi giỏ
export const removeFromCart = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const itemId = toInt(req.params.id);

    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, user_id: userId },
    });

    if (!item) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm trong giỏ' });
    }

    await prisma.cartItem.delete({ where: { id: itemId } });
    res.json({ message: 'Đã xóa khỏi giỏ hàng' });
  } catch (error: any) {
    handleError(res, 'Lỗi xóa khỏi giỏ', error);
  }
};
