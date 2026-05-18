/**
 * Address Controller - Quản lý địa chỉ giao hàng
 *
 * Mỗi user có thể lưu nhiều địa chỉ, 1 trong số đó là mặc định.
 *
 * 4 API:
 * - GET    /addresses     → Xem tất cả địa chỉ
 * - POST   /addresses     → Thêm địa chỉ mới
 * - PUT    /addresses/:id → Sửa địa chỉ
 * - DELETE /addresses/:id → Xóa địa chỉ
 */
import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../lib/prisma';
import { getUserId, handleError, toInt } from '../lib/helpers';

// Xem tất cả địa chỉ (mặc định lên đầu)
export const getAddresses = async (req: AuthRequest, res: Response) => {
  try {
    const addresses = await prisma.address.findMany({
      where: { user_id: getUserId(req) },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
    res.json(addresses);
  } catch (error: any) {
    handleError(res, 'Lỗi lấy danh sách địa chỉ', error);
  }
};

// Thêm địa chỉ mới
export const createAddress = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { name, phone, province, district, ward, detail, is_default } = req.body;

    // Kiểm tra đủ thông tin
    if (!name || !phone || !province || !district || !ward || !detail) {
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin địa chỉ' });
    }

    // Nếu đặt làm mặc định → bỏ mặc định của các địa chỉ khác
    if (is_default) {
      await prisma.address.updateMany({
        where: { user_id: userId, is_default: true },
        data: { is_default: false },
      });
    }

    const address = await prisma.address.create({
      data: { user_id: userId, name, phone, province, district, ward, detail, is_default: is_default || false },
    });

    res.status(201).json(address);
  } catch (error: any) {
    handleError(res, 'Lỗi tạo địa chỉ', error);
  }
};

// Sửa địa chỉ
export const updateAddress = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const addressId = toInt(req.params.id);
    const { name, phone, province, district, ward, detail, is_default } = req.body;

    // Kiểm tra địa chỉ có thuộc user này không
    const existing = await prisma.address.findFirst({
      where: { id: addressId, user_id: userId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Không tìm thấy địa chỉ' });
    }

    // Đặt làm mặc định → bỏ mặc định cũ
    if (is_default) {
      await prisma.address.updateMany({
        where: { user_id: userId, is_default: true },
        data: { is_default: false },
      });
    }

    const updated = await prisma.address.update({
      where: { id: addressId },
      data: {
        name: name || existing.name,
        phone: phone || existing.phone,
        province: province || existing.province,
        district: district || existing.district,
        ward: ward || existing.ward,
        detail: detail || existing.detail,
        is_default: is_default !== undefined ? is_default : existing.is_default,
      },
    });

    res.json(updated);
  } catch (error: any) {
    handleError(res, 'Lỗi cập nhật địa chỉ', error);
  }
};

// Xóa địa chỉ
export const deleteAddress = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const addressId = toInt(req.params.id);

    const existing = await prisma.address.findFirst({
      where: { id: addressId, user_id: userId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Không tìm thấy địa chỉ' });
    }

    await prisma.address.delete({ where: { id: addressId } });
    res.json({ message: 'Đã xóa địa chỉ' });
  } catch (error: any) {
    handleError(res, 'Lỗi xóa địa chỉ', error);
  }
};
