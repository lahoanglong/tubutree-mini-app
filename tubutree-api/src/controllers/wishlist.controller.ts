/**
 * Wishlist Controller - Danh sách yêu thích
 *
 * 3 API:
 * - GET    /wishlists              → Xem danh sách yêu thích
 * - POST   /wishlists              → Thêm vào yêu thích
 * - DELETE /wishlists/:productId   → Bỏ khỏi yêu thích
 */
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../lib/prisma';
import { getUserId, handleError } from '../lib/helpers';

// Xem danh sách yêu thích
export const getWishlist = async (req: AuthRequest, res: Response) => {
  try {
    const items = await prisma.wishlist.findMany({
      where: { user_id: getUserId(req) },
      orderBy: { created_at: 'desc' },
    });
    res.json(items);
  } catch (error: any) {
    handleError(res, 'Lỗi lấy danh sách yêu thích', error);
  }
};

// Thêm vào yêu thích
export const addToWishlist = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { pos_product_id } = req.body;

    if (!pos_product_id) {
      return res.status(400).json({ error: 'Cần có mã sản phẩm' });
    }

    // Đã có rồi → trả về luôn
    const existing = await prisma.wishlist.findUnique({
      where: { user_id_pos_product_id: { user_id: userId, pos_product_id } },
    });
    if (existing) {
      return res.json({ message: 'Đã có trong danh sách yêu thích', item: existing });
    }

    const item = await prisma.wishlist.create({
      data: { user_id: userId, pos_product_id },
    });
    res.status(201).json(item);
  } catch (error: any) {
    handleError(res, 'Lỗi thêm vào yêu thích', error);
  }
};

// Bỏ khỏi yêu thích
export const removeFromWishlist = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { productId } = req.params;

    const existing = await prisma.wishlist.findUnique({
      where: { user_id_pos_product_id: { user_id: userId, pos_product_id: productId } },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Không tìm thấy trong yêu thích' });
    }

    await prisma.wishlist.delete({ where: { id: existing.id } });
    res.json({ message: 'Đã bỏ khỏi yêu thích' });
  } catch (error: any) {
    handleError(res, 'Lỗi bỏ khỏi yêu thích', error);
  }
};
