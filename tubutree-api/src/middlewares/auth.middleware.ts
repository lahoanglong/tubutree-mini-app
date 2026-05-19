/**
 * Middleware Xác Thực (Authentication) + Authorization
 *
 * authenticateToken — verify JWT, load user từ DB, sync is_admin từ env,
 *                     từ chối nếu is_banned.
 * requireAdmin       — chỉ cho admin đi tiếp.
 * requireCapability  — gating theo capability (affiliate / agent).
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error('JWT_SECRET phải được set (>= 16 ký tự) trong .env. Không cho phép fallback.');
}

function getAdminWhitelist(): Set<string> {
  return new Set(
    (process.env.ADMIN_ZALO_UIDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  );
}

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    zaloUid: string;
    isAdmin: boolean;
    affiliateEnabled: boolean;
    agentEnabled: boolean;
  };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Chưa đăng nhập. Vui lòng cung cấp token.' });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(403).json({ error: 'Token không hợp lệ hoặc đã hết hạn.' });
  }

  // Load user từ DB để check trạng thái mới nhất
  const dbUser = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: {
      id: true, zalo_uid: true, is_admin: true,
      affiliate_enabled: true, agent_enabled: true,
      is_banned: true, ban_reason: true,
    },
  });

  if (!dbUser) {
    return res.status(403).json({ error: 'Tài khoản không tồn tại.' });
  }

  if (dbUser.is_banned) {
    return res.status(403).json({
      error: 'ACCOUNT_BANNED',
      reason: dbUser.ban_reason || 'Tài khoản đã bị tạm khoá. Vui lòng liên hệ admin.',
    });
  }

  // Sync is_admin từ env whitelist (single source of truth)
  const whitelist = getAdminWhitelist();
  const shouldBeAdmin = whitelist.has(dbUser.zalo_uid);
  if (shouldBeAdmin !== dbUser.is_admin) {
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { is_admin: shouldBeAdmin },
    });
    dbUser.is_admin = shouldBeAdmin;
  }

  req.user = {
    userId: dbUser.id,
    zaloUid: dbUser.zalo_uid,
    isAdmin: dbUser.is_admin,
    affiliateEnabled: dbUser.affiliate_enabled,
    agentEnabled: dbUser.agent_enabled,
  };
  next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'NOT_ADMIN', message: 'Yêu cầu quyền admin.' });
  }
  next();
};

export const requireCapability = (cap: 'affiliate' | 'agent') => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const enabled = cap === 'affiliate' ? req.user?.affiliateEnabled : req.user?.agentEnabled;
    if (!enabled) {
      return res.status(403).json({
        error: 'CAPABILITY_REQUIRED',
        capability: cap,
        message: cap === 'affiliate'
          ? 'Tính năng dành cho Cộng tác viên.'
          : 'Tính năng dành cho Đại lý.',
      });
    }
    next();
  };
};
