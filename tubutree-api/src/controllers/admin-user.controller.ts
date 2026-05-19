/**
 * Admin User Controller — list users, ban/unban toàn diện.
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { handleError, getPagination, toInt } from '../lib/helpers';
import { writeAudit } from '../lib/application-helpers';

export const listUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { search, banned } = req.query;
    const { page, limit, skip } = getPagination(req.query);

    const where: any = {};
    if (banned === 'true') where.is_banned = true;
    if (banned === 'false') where.is_banned = false;
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { phone: { contains: String(search) } },
        { zalo_uid: { contains: String(search) } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip, take: limit,
        select: {
          id: true, zalo_uid: true, name: true, phone: true, avatar: true,
          affiliate_enabled: true, agent_enabled: true, is_admin: true,
          is_banned: true, ban_reason: true, banned_at: true,
          created_at: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: items, total, page, limit });
  } catch (err) {
    handleError(res, 'Lỗi liệt kê users', err);
  }
};

export const getUserDetail = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.userId);
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        affiliate_apps: { where: { is_active: true }, take: 1 },
        agent_apps: { where: { is_active: true }, take: 1 },
      },
    });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
    res.json(user);
  } catch (err) {
    handleError(res, 'Lỗi lấy user', err);
  }
};

export const banUser = async (req: AuthRequest, res: Response) => {
  try {
    const targetId = toInt(req.params.userId);
    const adminUid = req.user!.zaloUid;
    const adminUserId = req.user!.userId;
    const reason = req.body?.reason;
    if (!reason) return res.status(400).json({ error: 'Thiếu lý do ban' });

    if (targetId === adminUserId) {
      return res.status(400).json({ error: 'CANNOT_BAN_SELF' });
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'Không tìm thấy user' });
    if (target.is_banned) return res.status(409).json({ error: 'User đã bị ban' });

    const updated = await prisma.$transaction(async (tx) => {
      // Cascade SUSPEND mọi application active
      const cascadeReason = `User banned: ${reason}`;
      const affActive = await tx.affiliateApplication.findFirst({
        where: { user_id: targetId, is_active: true, status: 'APPROVED' },
      });
      if (affActive) {
        await tx.affiliateApplication.update({
          where: { id: affActive.id },
          data: { status: 'SUSPENDED', suspended_reason: cascadeReason },
        });
        await writeAudit(tx, adminUid, 'SUSPEND_AFFILIATE', 'AFFILIATE_APP', affActive.id, cascadeReason);
      }
      const agtActive = await tx.agentApplication.findFirst({
        where: { user_id: targetId, is_active: true, status: 'APPROVED' },
      });
      if (agtActive) {
        await tx.agentApplication.update({
          where: { id: agtActive.id },
          data: { status: 'SUSPENDED', suspended_reason: cascadeReason },
        });
        await writeAudit(tx, adminUid, 'SUSPEND_AGENT', 'AGENT_APP', agtActive.id, cascadeReason);
      }

      const u = await tx.user.update({
        where: { id: targetId },
        data: {
          is_banned: true,
          banned_at: new Date(),
          banned_by_uid: adminUid,
          ban_reason: reason,
          affiliate_enabled: false,
          agent_enabled: false,
        },
      });
      await writeAudit(tx, adminUid, 'BAN_USER', 'USER', targetId, reason);
      return u;
    });

    res.json(updated);
  } catch (err) {
    handleError(res, 'Lỗi ban user', err);
  }
};

export const unbanUser = async (req: AuthRequest, res: Response) => {
  try {
    const targetId = toInt(req.params.userId);
    const adminUid = req.user!.zaloUid;

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'Không tìm thấy user' });
    if (!target.is_banned) return res.status(409).json({ error: 'User không bị ban' });

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetId },
        data: {
          is_banned: false,
          banned_at: null,
          banned_by_uid: null,
          ban_reason: null,
        },
      });
      await writeAudit(tx, adminUid, 'UNBAN_USER', 'USER', targetId);
      return u;
    });

    res.json(updated);
  } catch (err) {
    handleError(res, 'Lỗi unban user', err);
  }
};
