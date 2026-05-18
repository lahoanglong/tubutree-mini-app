/**
 * Notification Controller - Thông báo cho user
 *
 * Thông báo được tạo tự động bởi hệ thống (khi đơn hàng cập nhật, v.v.)
 *
 * 3 API:
 * - GET /notifications          → Xem thông báo (có phân trang)
 * - PUT /notifications/:id/read → Đánh dấu đã đọc 1 thông báo
 * - PUT /notifications/read-all → Đánh dấu đã đọc tất cả
 */
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../lib/prisma';
import { getUserId, handleError, getPagination, toInt } from '../lib/helpers';

// Xem danh sách thông báo
export const getNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { page, limit, skip } = getPagination(req.query);

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: { user_id: userId } }),
      prisma.notification.count({ where: { user_id: userId, is_read: false } }),
    ]);

    res.json({
      notifications,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    handleError(res, 'Lỗi lấy thông báo', error);
  }
};

// Đánh dấu 1 thông báo đã đọc
export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const notifId = toInt(req.params.id);

    const notif = await prisma.notification.findFirst({
      where: { id: notifId, user_id: getUserId(req) },
    });
    if (!notif) return res.status(404).json({ error: 'Không tìm thấy thông báo' });

    await prisma.notification.update({ where: { id: notifId }, data: { is_read: true } });
    res.json({ message: 'Đã đánh dấu đã đọc' });
  } catch (error: any) {
    handleError(res, 'Lỗi đánh dấu thông báo', error);
  }
};

// Đánh dấu tất cả đã đọc
export const markAllAsRead = async (req: AuthRequest, res: Response) => {
  try {
    await prisma.notification.updateMany({
      where: { user_id: getUserId(req), is_read: false },
      data: { is_read: true },
    });
    res.json({ message: 'Đã đánh dấu tất cả đã đọc' });
  } catch (error: any) {
    handleError(res, 'Lỗi đánh dấu thông báo', error);
  }
};

// Hàm nội bộ: Tạo thông báo (dùng bởi webhook và order controller)
export const createNotification = async (
  userId: number,
  title: string,
  body: string,
  type = 'SYSTEM'
) => {
  try {
    return await prisma.notification.create({
      data: { user_id: userId, title, body, type },
    });
  } catch (error: any) {
    console.error('Lỗi tạo thông báo:', error.message);
  }
};
