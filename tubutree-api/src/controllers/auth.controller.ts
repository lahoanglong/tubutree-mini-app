/**
 * Auth Controller - Đăng nhập bằng Zalo
 *
 * Luồng đăng nhập:
 * 1. Mini App gửi accessToken của Zalo lên
 * 2. Server gọi Zalo API để xác minh và lấy thông tin user
 * 3. Tạo hoặc cập nhật user trong database; sync is_admin từ env whitelist
 * 4. Chặn nếu is_banned
 * 5. Trả về JWT token + capabilities
 */
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { verifyZaloTokenAndGetUserInfo } from '../services/zalo.service';
import { handleError } from '../lib/helpers';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error('JWT_SECRET phải được set (>= 16 ký tự) trong .env. Không cho phép fallback.');
}

function isAdminUid(zaloUid: string): boolean {
  const wl = (process.env.ADMIN_ZALO_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return wl.includes(zaloUid);
}

export const loginWithZalo = async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'Cần gửi accessToken của Zalo' });
    }

    const zaloUser = await verifyZaloTokenAndGetUserInfo(accessToken);

    if (!zaloUser || !zaloUser.id) {
      return res.status(401).json({ error: 'Token Zalo không hợp lệ' });
    }

    const zaloUid = zaloUser.id.toString();
    const shouldBeAdmin = isAdminUid(zaloUid);

    let user = await prisma.user.findUnique({ where: { zalo_uid: zaloUid } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          zalo_uid: zaloUid,
          name: zaloUser.name,
          avatar: zaloUser.picture?.data?.url || null,
          is_admin: shouldBeAdmin,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: zaloUser.name,
          avatar: zaloUser.picture?.data?.url || user.avatar,
          is_admin: shouldBeAdmin,
        },
      });
    }

    // Chặn user bị banned ngay từ login
    if (user.is_banned) {
      return res.status(403).json({
        error: 'ACCOUNT_BANNED',
        reason: user.ban_reason || 'Tài khoản đã bị tạm khoá.',
      });
    }

    const token = jwt.sign(
      { userId: user.id, zaloUid: user.zalo_uid },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        phone: user.phone,
        affiliate_enabled: user.affiliate_enabled,
        agent_enabled: user.agent_enabled,
        is_admin: user.is_admin,
      },
    });
  } catch (error: any) {
    handleError(res, 'Lỗi đăng nhập', error);
  }
};
