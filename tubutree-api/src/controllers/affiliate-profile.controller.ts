/**
 * Affiliate Profile Controller — user xem stats, list referrals, commissions.
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getUserId, handleError, getPagination } from '../lib/helpers';
import { ensureAffiliateProfile, attributeReferrer, getWalletBalance } from '../services/affiliate.service';

export const getMyProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!req.user!.affiliateEnabled) {
      return res.status(403).json({ error: 'CAPABILITY_REQUIRED', capability: 'affiliate' });
    }
    const profile = await ensureAffiliateProfile(userId);
    res.json(serializeProfile(profile));
  } catch (err) { handleError(res, 'Lỗi lấy profile CTV', err); }
};

export const getMyReferrals = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { page, limit, skip } = getPagination(req.query);
    const [items, total] = await Promise.all([
      prisma.referral.findMany({
        where: { referrer_user_id: userId },
        orderBy: { created_at: 'desc' },
        skip, take: limit,
      }),
      prisma.referral.count({ where: { referrer_user_id: userId } }),
    ]);
    res.json({ data: items, total, page, limit });
  } catch (err) { handleError(res, 'Lỗi lấy referrals', err); }
};

export const getMyCommissions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { page, limit, skip } = getPagination(req.query);
    const [items, total] = await Promise.all([
      prisma.commissionLedger.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip, take: limit,
      }),
      prisma.commissionLedger.count({ where: { user_id: userId } }),
    ]);
    res.json({ data: items.map(i => ({ ...i, amount: i.amount.toString() })), total, page, limit });
  } catch (err) { handleError(res, 'Lỗi lấy commissions', err); }
};

export const attributeReferralController = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const refCode = String(req.body.ref_code || '').toUpperCase().trim();
    if (!refCode) return res.status(400).json({ error: 'Thiếu ref_code' });

    const r = await attributeReferrer(userId, refCode);
    res.json(r);
  } catch (err: any) {
    if (err.message === 'REFERRAL_CODE_NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.message === 'SELF_REFERRAL_NOT_ALLOWED') return res.status(400).json({ error: err.message });
    handleError(res, 'Lỗi gán referrer', err);
  }
};

export const getMyReferrer = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const ref = await prisma.referral.findFirst({
      where: { referred_user_id: userId, expires_at: { gt: new Date() } },
    });
    if (!ref) return res.json(null);
    const referrer = await prisma.user.findUnique({
      where: { id: ref.referrer_user_id },
      select: { id: true, name: true },
    });
    res.json({ referrer, expires_at: ref.expires_at });
  } catch (err) { handleError(res, 'Lỗi', err); }
};

export const getWallet = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const balance = await getWalletBalance(userId);
    res.json({ balance: balance.toString() });
  } catch (err) { handleError(res, 'Lỗi wallet', err); }
};

export const getWalletHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { page, limit, skip } = getPagination(req.query);
    const [items, total] = await Promise.all([
      prisma.walletLedger.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip, take: limit,
      }),
      prisma.walletLedger.count({ where: { user_id: userId } }),
    ]);
    res.json({ data: items.map(i => ({ ...i, amount: i.amount.toString() })), total, page, limit });
  } catch (err) { handleError(res, 'Lỗi wallet history', err); }
};

function serializeProfile(p: any) {
  return {
    ...p,
    total_commission: p.total_commission.toString(),
  };
}
