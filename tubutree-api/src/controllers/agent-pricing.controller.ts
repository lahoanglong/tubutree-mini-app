/**
 * Agent Pricing Controller — user (đại lý) xem profile + giá sỉ.
 * Admin quản lý tier + đổi tier cho từng đại lý.
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getUserId, handleError, toInt } from '../lib/helpers';
import { getMyAgentInfo, ensureAgentProfile, wholesalePrice, seedTiersIfEmpty } from '../services/agent-pricing.service';

// ===== USER =====
export const getMyAgentProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!req.user!.agentEnabled) {
      return res.status(403).json({ error: 'CAPABILITY_REQUIRED', capability: 'agent' });
    }
    await ensureAgentProfile(userId);
    const info = await getMyAgentInfo(userId);
    res.json(info);
  } catch (err) { handleError(res, 'Lỗi profile đại lý', err); }
};

// ===== ADMIN =====
export const listTiers = async (_req: AuthRequest, res: Response) => {
  try {
    await seedTiersIfEmpty();
    const tiers = await prisma.agentTier.findMany({ orderBy: { sort_order: 'asc' } });
    res.json(tiers.map(t => ({ ...t, min_order_vnd: t.min_order_vnd.toString() })));
  } catch (err) { handleError(res, 'Lỗi tiers', err); }
};

export const createTier = async (req: AuthRequest, res: Response) => {
  try {
    const { code, name, discount_pct, min_order_vnd, sort_order } = req.body;
    if (!code || !name || discount_pct == null || min_order_vnd == null) {
      return res.status(400).json({ error: 'Thiếu trường' });
    }
    const t = await prisma.agentTier.create({
      data: {
        code: String(code).toUpperCase(),
        name, discount_pct: Number(discount_pct),
        min_order_vnd: BigInt(min_order_vnd),
        sort_order: sort_order || 0,
      },
    });
    res.status(201).json({ ...t, min_order_vnd: t.min_order_vnd.toString() });
  } catch (err) { handleError(res, 'Lỗi tạo tier', err); }
};

export const updateTier = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const data: any = {};
    ['name', 'discount_pct', 'sort_order', 'is_active'].forEach(k => {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    });
    if (req.body.min_order_vnd !== undefined) data.min_order_vnd = BigInt(req.body.min_order_vnd);
    const t = await prisma.agentTier.update({ where: { id }, data });
    res.json({ ...t, min_order_vnd: t.min_order_vnd.toString() });
  } catch (err) { handleError(res, 'Lỗi update tier', err); }
};

export const listAgentProfiles = async (_req: AuthRequest, res: Response) => {
  try {
    const items = await prisma.agentProfile.findMany({
      include: {
        user: { select: { id: true, name: true, phone: true, zalo_uid: true } },
        tier: true,
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(items.map(i => ({
      ...i,
      tier: { ...i.tier, min_order_vnd: i.tier.min_order_vnd.toString() },
    })));
  } catch (err) { handleError(res, 'Lỗi list profiles', err); }
};

export const setAgentTier = async (req: AuthRequest, res: Response) => {
  try {
    const userId = toInt(req.params.userId);
    const adminUserId = req.user!.userId;
    const { tier_id } = req.body;
    if (!tier_id) return res.status(400).json({ error: 'Thiếu tier_id' });
    if (userId === adminUserId) {
      return res.status(403).json({ error: 'CANNOT_MODIFY_SELF', message: 'Không thể tự đổi tier của chính mình.' });
    }
    const tier = await prisma.agentTier.findUnique({ where: { id: Number(tier_id) } });
    if (!tier) return res.status(404).json({ error: 'Tier không tồn tại' });
    const profile = await prisma.agentProfile.upsert({
      where: { user_id: userId },
      update: { tier_id: Number(tier_id) },
      create: { user_id: userId, tier_id: Number(tier_id) },
      include: { tier: true },
    });
    res.json({ ...profile, tier: { ...profile.tier, min_order_vnd: profile.tier.min_order_vnd.toString() } });
  } catch (err) { handleError(res, 'Lỗi set tier', err); }
};

// Test helper endpoint — preview giá sỉ cho 1 retail price
export const previewWholesale = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const retailRaw = String(req.query.retail || '');
    if (!/^\d+$/.test(retailRaw)) return res.status(400).json({ error: 'retail phải là số nguyên dương' });
    const retail = BigInt(retailRaw);
    const ws = await wholesalePrice(userId, retail);
    res.json({ retail: retail.toString(), wholesale: ws == null ? null : ws.toString() });
  } catch (err) { handleError(res, 'Lỗi preview', err); }
};
