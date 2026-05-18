/**
 * Auth Controller - Đăng nhập bằng Zalo
 *
 * Luồng đăng nhập:
 * 1. Mini App gửi accessToken của Zalo lên
 * 2. Server gọi Zalo API để xác minh và lấy thông tin user
 * 3. Tạo hoặc cập nhật user trong database
 * 4. Trả về JWT token để dùng cho các request sau
 */
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { verifyZaloTokenAndGetUserInfo } from '../services/zalo.service';
import { handleError } from '../lib/helpers';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

export const loginWithZalo = async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Cần gửi accessToken của Zalo' });
    }

    // Bước 1: Xác minh token với Zalo
    const zaloUser = await verifyZaloTokenAndGetUserInfo(accessToken);

    if (!zaloUser || !zaloUser.id) {
      return res.status(401).json({ error: 'Token Zalo không hợp lệ' });
    }

    // Bước 2: Tìm hoặc tạo user trong database
    let user = await prisma.user.findUnique({
      where: { zalo_uid: zaloUser.id.toString() },
    });

    if (!user) {
      // User mới → tạo tài khoản
      user = await prisma.user.create({
        data: {
          zalo_uid: zaloUser.id.toString(),
          name: zaloUser.name,
          avatar: zaloUser.picture?.data?.url || null,
        },
      });
    } else {
      // User cũ → cập nhật tên/ảnh nếu thay đổi
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: zaloUser.name,
          avatar: zaloUser.picture?.data?.url || user.avatar,
        },
      });
    }

    // Bước 3: Tạo JWT token (hết hạn sau 30 ngày)
    const token = jwt.sign(
      { userId: user.id, zaloUid: user.zalo_uid },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Bước 4: Trả về token + thông tin user
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        phone: user.phone,
      },
    });
  } catch (error: any) {
    handleError(res, 'Lỗi đăng nhập', error);
  }
};
