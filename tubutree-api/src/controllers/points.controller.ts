/**
 * Points Controller — Hiển thị balance, history, preview redeem.
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getUserId, handleError, getPagination } from '../lib/helpers';
import { getBalance, getLifetime, previewRedeem, getConfig } from '../services/points.service';

export const getMyBalance = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const [balance, lifetime, config] = await Promise.all([
      getBalance(userId),
      getLifetime(userId),
      getConfig(),
    ]);
    res.json({ balance, lifetime, config });
  } catch (err) { handleError(res, 'Lỗi lấy điểm', err); }
};

export const getMyHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { page, limit, skip } = getPagination(req.query);
    const [items, total] = await Promise.all([
      prisma.pointsLedger.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip, take: limit,
      }),
      prisma.pointsLedger.count({ where: { user_id: userId } }),
    ]);
    res.json({ data: items, total, page, limit });
  } catch (err) { handleError(res, 'Lỗi lấy lịch sử', err); }
};

export const previewRedeemController = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const points = Number(req.body.points_to_redeem);
    const orderTotal = Number(req.body.order_total);
    if (!points || !orderTotal) {
      return res.status(400).json({ error: 'Thiếu points_to_redeem hoặc order_total' });
    }
    const r = await previewRedeem(userId, points, orderTotal);
    res.json(r);
  } catch (err) { handleError(res, 'Lỗi preview', err); }
};
