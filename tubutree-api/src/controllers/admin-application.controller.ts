/**
 * Admin Application Controller — duyệt/từ chối/treo/khôi phục đơn CTV và Đại lý.
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { handleError, getPagination, toInt } from '../lib/helpers';
import { writeAudit, syncUserFlag } from '../lib/application-helpers';
import { ensureAffiliateProfile } from '../services/affiliate.service';
import { ensureAgentProfile } from '../services/agent-pricing.service';

type Kind = 'affiliate' | 'agent';
const modelOf = (k: Kind) => (k === 'affiliate' ? prisma.affiliateApplication : prisma.agentApplication);
const auditTargetOf = (k: Kind): 'AFFILIATE_APP' | 'AGENT_APP' => (k === 'affiliate' ? 'AFFILIATE_APP' : 'AGENT_APP');

export const listApplications = (kind: Kind) => async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const { page, limit, skip } = getPagination(req.query);
    const where: any = {};
    if (status) where.status = String(status);

    const model: any = modelOf(kind);
    const [items, total] = await Promise.all([
      model.findMany({
        where,
        orderBy: { submitted_at: 'desc' },
        skip, take: limit,
        include: { user: { select: { id: true, name: true, phone: true, zalo_uid: true } } },
      }),
      model.count({ where }),
    ]);

    res.json({ data: items, total, page, limit });
  } catch (err) {
    handleError(res, 'Lỗi liệt kê đơn', err);
  }
};

export const getApplicationDetail = (kind: Kind) => async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const model: any = modelOf(kind);
    const item = await model.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, phone: true, zalo_uid: true, avatar: true } } },
    });
    if (!item) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    res.json(item);
  } catch (err) {
    handleError(res, 'Lỗi lấy đơn', err);
  }
};

export const approveApplication = (kind: Kind) => async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const adminUid = req.user!.zaloUid;
    const adminUserId = req.user!.userId;
    const model: any = modelOf(kind);

    const app = await model.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    if (app.user_id === adminUserId) {
      return res.status(403).json({ error: 'CANNOT_REVIEW_OWN_APPLICATION', message: 'Không thể tự duyệt đơn của chính mình.' });
    }
    if (app.status !== 'PENDING') {
      return res.status(409).json({ error: `Chỉ có thể duyệt đơn PENDING, đơn này: ${app.status}` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Mọi đơn cũ deactivate (giữ history)
      const txModel: any = kind === 'affiliate' ? tx.affiliateApplication : tx.agentApplication;
      await txModel.updateMany({
        where: { user_id: app.user_id, is_active: true, NOT: { id } },
        data: { is_active: false },
      });

      const u = await txModel.update({
        where: { id },
        data: {
          status: 'APPROVED', is_active: true,
          reviewed_at: new Date(), reviewed_by_uid: adminUid,
          reject_reason: null, suspended_reason: null,
        },
      });
      await syncUserFlag(tx, app.user_id, kind, true);
      await writeAudit(tx, adminUid, `APPROVE_${kind.toUpperCase()}`, auditTargetOf(kind), id);
      return u;
    });

    // Auto-create profile sau khi approve
    if (kind === 'affiliate') {
      try { await ensureAffiliateProfile(app.user_id); }
      catch (e: any) { console.error('ensureAffiliateProfile lỗi:', e.message); }
    }
    if (kind === 'agent') {
      try { await ensureAgentProfile(app.user_id); }
      catch (e: any) { console.error('ensureAgentProfile lỗi:', e.message); }
    }

    res.json(updated);
  } catch (err) {
    handleError(res, 'Lỗi duyệt đơn', err);
  }
};

export const rejectApplication = (kind: Kind) => async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const adminUid = req.user!.zaloUid;
    const adminUserId = req.user!.userId;
    const reason = req.body?.reason;
    if (!reason || String(reason).trim() === '') return res.status(400).json({ error: 'Thiếu lý do từ chối' });

    const model: any = modelOf(kind);
    const app = await model.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    if (app.user_id === adminUserId) {
      return res.status(403).json({ error: 'CANNOT_REVIEW_OWN_APPLICATION' });
    }
    if (app.status !== 'PENDING') {
      return res.status(409).json({ error: `Chỉ có thể từ chối đơn PENDING` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const txModel: any = kind === 'affiliate' ? tx.affiliateApplication : tx.agentApplication;
      const u = await txModel.update({
        where: { id },
        data: {
          status: 'REJECTED', is_active: false,
          reviewed_at: new Date(), reviewed_by_uid: adminUid,
          reject_reason: reason,
        },
      });
      await writeAudit(tx, adminUid, `REJECT_${kind.toUpperCase()}`, auditTargetOf(kind), id, reason);
      return u;
    });

    res.json(updated);
  } catch (err) {
    handleError(res, 'Lỗi từ chối đơn', err);
  }
};

export const suspendApplication = (kind: Kind) => async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const adminUid = req.user!.zaloUid;
    const adminUserId = req.user!.userId;
    const reason = req.body?.reason;
    if (!reason) return res.status(400).json({ error: 'Thiếu lý do tạm ngưng' });

    const model: any = modelOf(kind);
    const app = await model.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    if (app.user_id === adminUserId) {
      return res.status(403).json({ error: 'CANNOT_REVIEW_OWN_APPLICATION' });
    }
    if (app.status !== 'APPROVED') {
      return res.status(409).json({ error: 'Chỉ tạm ngưng được đơn APPROVED' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const txModel: any = kind === 'affiliate' ? tx.affiliateApplication : tx.agentApplication;
      const u = await txModel.update({
        where: { id },
        data: { status: 'SUSPENDED', suspended_reason: reason },
      });
      await syncUserFlag(tx, app.user_id, kind, false);
      await writeAudit(tx, adminUid, `SUSPEND_${kind.toUpperCase()}`, auditTargetOf(kind), id, reason);
      return u;
    });

    res.json(updated);
  } catch (err) {
    handleError(res, 'Lỗi tạm ngưng', err);
  }
};

export const restoreApplication = (kind: Kind) => async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const adminUid = req.user!.zaloUid;
    const adminUserId = req.user!.userId;
    const model: any = modelOf(kind);
    const app = await model.findUnique({ where: { id } });
    if (!app) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    if (app.user_id === adminUserId) {
      return res.status(403).json({ error: 'CANNOT_REVIEW_OWN_APPLICATION' });
    }
    if (app.status !== 'SUSPENDED') {
      return res.status(409).json({ error: 'Chỉ khôi phục được đơn SUSPENDED' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const txModel: any = kind === 'affiliate' ? tx.affiliateApplication : tx.agentApplication;
      const u = await txModel.update({
        where: { id },
        data: { status: 'APPROVED', is_active: true, suspended_reason: null },
      });
      await syncUserFlag(tx, app.user_id, kind, true);
      await writeAudit(tx, adminUid, `RESTORE_${kind.toUpperCase()}`, auditTargetOf(kind), id);
      return u;
    });

    res.json(updated);
  } catch (err) {
    handleError(res, 'Lỗi khôi phục', err);
  }
};
