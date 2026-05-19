/**
 * Capabilities Controller — Truy vấn trạng thái CTV/Đại lý/Admin của bản thân.
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getUserId, handleError } from '../lib/helpers';

export const getMyCapabilities = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);

    const [user, affApp, agtApp] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, name: true, phone: true, avatar: true,
          affiliate_enabled: true, agent_enabled: true, is_admin: true,
          is_banned: true, ban_reason: true,
        },
      }),
      prisma.affiliateApplication.findFirst({
        where: { user_id: userId, is_active: true },
      }),
      prisma.agentApplication.findFirst({
        where: { user_id: userId, is_active: true },
      }),
    ]);

    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

    res.json({
      user,
      affiliate_application: affApp,
      agent_application: agtApp,
    });
  } catch (err) {
    handleError(res, 'Lỗi lấy capabilities', err);
  }
};
