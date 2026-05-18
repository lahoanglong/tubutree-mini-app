/**
 * Banner Controller - Quản lý banner quảng cáo
 *
 * Banner hiển thị trên trang chủ Mini App.
 * Có 2 nhóm API: công khai (cho Mini App) và admin (quản lý).
 *
 * Công khai:
 * - GET /banners → Banner đang hoạt động
 *
 * Admin:
 * - GET    /banners/admin      → Tất cả banner
 * - POST   /banners/admin      → Tạo banner
 * - PUT    /banners/admin/:id  → Sửa banner
 * - DELETE /banners/admin/:id  → Xóa banner
 */
import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { handleError, toInt } from '../lib/helpers';

// ========== CÔNG KHAI ==========

// Lấy banner đang hoạt động (trong khoảng thời gian hiển thị)
export const getActiveBanners = async (req: Request, res: Response) => {
  try {
    const now = new Date();

    const banners = await prisma.banner.findMany({
      where: {
        is_active: true,
        OR: [
          { start_date: null, end_date: null },        // Không giới hạn thời gian
          { start_date: { lte: now }, end_date: { gte: now } }, // Trong khoảng
          { start_date: { lte: now }, end_date: null },  // Chỉ có ngày bắt đầu
          { start_date: null, end_date: { gte: now } },  // Chỉ có ngày kết thúc
        ],
      },
      orderBy: { sort_order: 'asc' },
    });

    res.json(banners);
  } catch (error: any) {
    handleError(res, 'Lỗi lấy banner', error);
  }
};

// ========== ADMIN ==========

// Xem tất cả banner
export const getAllBanners = async (req: Request, res: Response) => {
  try {
    const banners = await prisma.banner.findMany({ orderBy: { sort_order: 'asc' } });
    res.json(banners);
  } catch (error: any) {
    handleError(res, 'Lỗi lấy danh sách banner', error);
  }
};

// Tạo banner mới
export const createBanner = async (req: Request, res: Response) => {
  try {
    const { image_url, link, sort_order, is_active, start_date, end_date } = req.body;

    if (!image_url) {
      return res.status(400).json({ error: 'Cần có URL hình ảnh' });
    }

    const banner = await prisma.banner.create({
      data: {
        image_url,
        link: link || null,
        sort_order: sort_order || 0,
        is_active: is_active !== undefined ? is_active : true,
        start_date: start_date ? new Date(start_date) : null,
        end_date: end_date ? new Date(end_date) : null,
      },
    });

    res.status(201).json(banner);
  } catch (error: any) {
    handleError(res, 'Lỗi tạo banner', error);
  }
};

// Sửa banner
export const updateBanner = async (req: Request, res: Response) => {
  try {
    const bannerId = toInt(req.params.id);
    const { image_url, link, sort_order, is_active, start_date, end_date } = req.body;

    const existing = await prisma.banner.findUnique({ where: { id: bannerId } });
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy banner' });

    const updated = await prisma.banner.update({
      where: { id: bannerId },
      data: {
        image_url: image_url || existing.image_url,
        link: link !== undefined ? link : existing.link,
        sort_order: sort_order !== undefined ? sort_order : existing.sort_order,
        is_active: is_active !== undefined ? is_active : existing.is_active,
        start_date: start_date !== undefined ? (start_date ? new Date(start_date) : null) : existing.start_date,
        end_date: end_date !== undefined ? (end_date ? new Date(end_date) : null) : existing.end_date,
      },
    });

    res.json(updated);
  } catch (error: any) {
    handleError(res, 'Lỗi cập nhật banner', error);
  }
};

// Xóa banner
export const deleteBanner = async (req: Request, res: Response) => {
  try {
    const bannerId = toInt(req.params.id);

    const existing = await prisma.banner.findUnique({ where: { id: bannerId } });
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy banner' });

    await prisma.banner.delete({ where: { id: bannerId } });
    res.json({ message: 'Đã xóa banner' });
  } catch (error: any) {
    handleError(res, 'Lỗi xóa banner', error);
  }
};
