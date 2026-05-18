/**
 * Review Controller - Đánh giá sản phẩm
 *
 * 2 API:
 * - GET  /reviews/product/:productId → Xem đánh giá (công khai)
 * - POST /reviews                    → Viết đánh giá (cần đăng nhập)
 */
import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../lib/prisma';
import { getUserId, handleError, getPagination } from '../lib/helpers';

// Xem đánh giá của 1 sản phẩm
export const getProductReviews = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { page, limit, skip } = getPagination(req.query);
    const ratingFilter = req.query.rating ? parseInt(req.query.rating as string) : undefined;

    const where: any = { pos_product_id: productId };
    if (ratingFilter) where.rating = ratingFilter;

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        include: { user: { select: { name: true, avatar: true } } },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.review.count({ where }),
    ]);

    // Tính điểm trung bình
    const avg = await prisma.review.aggregate({
      where: { pos_product_id: productId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    res.json({
      reviews,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary: {
        averageRating: avg._avg.rating ? Number(avg._avg.rating.toFixed(1)) : 0,
        totalReviews: avg._count.rating,
      },
    });
  } catch (error: any) {
    handleError(res, 'Lỗi lấy đánh giá', error);
  }
};

// Viết đánh giá
export const createReview = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { pos_product_id, order_ref_id, rating, comment, images } = req.body;

    if (!pos_product_id || !rating) {
      return res.status(400).json({ error: 'Cần có mã sản phẩm và số sao' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Số sao phải từ 1 đến 5' });
    }

    // Kiểm tra đơn hàng (nếu có)
    if (order_ref_id) {
      const order = await prisma.orderRef.findFirst({ where: { id: order_ref_id, user_id: userId } });
      if (!order) return res.status(400).json({ error: 'Đơn hàng không tồn tại' });
    }

    // Kiểm tra đã đánh giá chưa
    const existing = await prisma.review.findFirst({
      where: { user_id: userId, pos_product_id, order_ref_id: order_ref_id || null },
    });
    if (existing) {
      return res.status(400).json({ error: 'Bạn đã đánh giá sản phẩm này rồi' });
    }

    const review = await prisma.review.create({
      data: {
        user_id: userId,
        pos_product_id,
        order_ref_id: order_ref_id || null,
        rating,
        comment: comment || null,
        images: images ? JSON.stringify(images) : null,
      },
      include: { user: { select: { name: true, avatar: true } } },
    });

    res.status(201).json(review);
  } catch (error: any) {
    handleError(res, 'Lỗi tạo đánh giá', error);
  }
};
