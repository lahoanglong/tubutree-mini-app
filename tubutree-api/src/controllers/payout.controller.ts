/**
 * Payout Controller — user request rút tiền + admin duyệt.
 *
 * Logic ví:
 * - Tạo request → ngay lập tức tạo WalletLedger.PAYOUT_OUT (-amount) để "hold".
 * - REJECT → tạo PAYOUT_REVERSE (+amount) để hoàn lại.
 * - COMPLETE → giữ nguyên PAYOUT_OUT (đã chuyển khoản).
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getUserId, handleError, getPagination, toInt } from '../lib/helpers';
import { writeAudit } from '../lib/application-helpers';
import { uploadKYC, toRelativeUrl } from '../lib/upload';

const MIN_PAYOUT = BigInt(100_000);

export const requestPayout = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const amountRaw = req.body.amount_vnd;
    // Validate: chỉ chấp nhận integer string/number, không dấu phẩy
    if (amountRaw == null || !/^\d+$/.test(String(amountRaw))) {
      return res.status(400).json({ error: 'amount_vnd phải là số nguyên dương' });
    }
    const amount = BigInt(amountRaw);
    if (amount < MIN_PAYOUT) {
      return res.status(400).json({ error: `Số tiền tối thiểu ${MIN_PAYOUT.toString()} VND` });
    }

    // Snapshot bank info từ AffiliateApplication active
    const aff = await prisma.affiliateApplication.findFirst({
      where: { user_id: userId, is_active: true, status: 'APPROVED' },
    });
    if (!aff) {
      return res.status(403).json({ error: 'NO_BANK_INFO', message: 'Cần là CTV đã duyệt với thông tin ngân hàng.' });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Re-check trong tx Serializable — race-safe
        const pending = await tx.payoutRequest.findFirst({
          where: { user_id: userId, status: { in: ['PENDING', 'APPROVED'] } },
        });
        if (pending) {
          throw new PayoutError('PAYOUT_IN_PROGRESS', 'Bạn đang có lệnh rút chưa hoàn tất.');
        }

        const balAgg = await tx.walletLedger.aggregate({
          where: { user_id: userId }, _sum: { amount: true },
        });
        const balance = balAgg._sum.amount || 0n;
        if (amount > balance) {
          throw new PayoutError('INSUFFICIENT_BALANCE', `Không đủ số dư (hiện có ${balance.toString()})`);
        }

        const payout = await tx.payoutRequest.create({
          data: {
            user_id: userId,
            amount_vnd: amount,
            status: 'PENDING',
            bank_name: aff.bank_name,
            bank_account_no: aff.bank_account_no,
            bank_account_name: aff.bank_account_name,
          },
        });
        await tx.walletLedger.create({
          data: {
            user_id: userId,
            type: 'PAYOUT_OUT',
            amount: -amount,
            ref_id: payout.id,
            note: `Hold rút tiền #${payout.id}`,
          },
        });
        return payout;
      }, { isolationLevel: 'Serializable' });

      res.status(201).json({ ...result, amount_vnd: result.amount_vnd.toString() });
    } catch (e: any) {
      // Serialization failure (40001) hoặc PayoutError → return 409
      if (e instanceof PayoutError) {
        return res.status(409).json({ error: e.code, message: e.message });
      }
      // P2034 (Prisma serialization conflict) — yêu cầu user thử lại
      if (e.code === 'P2034') {
        return res.status(409).json({ error: 'CONCURRENT_REQUEST', message: 'Vui lòng thử lại.' });
      }
      throw e;
    }
  } catch (err: any) {
    handleError(res, 'Lỗi tạo lệnh rút', err);
  }
};

class PayoutError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const listMyPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { page, limit, skip } = getPagination(req.query);
    const [items, total] = await Promise.all([
      prisma.payoutRequest.findMany({
        where: { user_id: userId },
        orderBy: { requested_at: 'desc' },
        skip, take: limit,
      }),
      prisma.payoutRequest.count({ where: { user_id: userId } }),
    ]);
    res.json({
      data: items.map(i => ({ ...i, amount_vnd: i.amount_vnd.toString() })),
      total, page, limit,
    });
  } catch (err) { handleError(res, 'Lỗi list payouts', err); }
};

// ==== ADMIN ====
export const adminListPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;
    const { page, limit, skip } = getPagination(req.query);
    const where: any = {};
    if (status) where.status = String(status);
    const [items, total] = await Promise.all([
      prisma.payoutRequest.findMany({
        where, orderBy: { requested_at: 'desc' }, skip, take: limit,
        include: { user: { select: { id: true, name: true, phone: true, zalo_uid: true } } },
      }),
      prisma.payoutRequest.count({ where }),
    ]);
    res.json({
      data: items.map(i => ({ ...i, amount_vnd: i.amount_vnd.toString() })),
      total, page, limit,
    });
  } catch (err) { handleError(res, 'Lỗi admin list payouts', err); }
};

export const adminApprovePayout = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const adminUid = req.user!.zaloUid;
    const adminUserId = req.user!.userId;
    const p = await prisma.payoutRequest.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: 'Không tìm thấy' });
    if (p.user_id === adminUserId) return res.status(403).json({ error: 'CANNOT_REVIEW_OWN_PAYOUT' });
    if (p.status !== 'PENDING') return res.status(409).json({ error: `Chỉ duyệt PENDING (hiện: ${p.status})` });

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.payoutRequest.update({
        where: { id }, data: { status: 'APPROVED', reviewed_at: new Date(), reviewed_by_uid: adminUid },
      });
      await writeAudit(tx, adminUid, 'APPROVE_PAYOUT', 'USER', p.user_id, undefined, { payout_id: id, amount: p.amount_vnd.toString() });
      return u;
    });
    res.json({ ...updated, amount_vnd: updated.amount_vnd.toString() });
  } catch (err) { handleError(res, 'Lỗi approve payout', err); }
};

export const adminRejectPayout = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const adminUid = req.user!.zaloUid;
    const adminUserId = req.user!.userId;
    const reason = req.body?.reason;
    if (!reason) return res.status(400).json({ error: 'Thiếu lý do' });

    const p = await prisma.payoutRequest.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: 'Không tìm thấy' });
    if (p.user_id === adminUserId) return res.status(403).json({ error: 'CANNOT_REVIEW_OWN_PAYOUT' });
    if (!['PENDING', 'APPROVED'].includes(p.status)) {
      return res.status(409).json({ error: `Không thể reject ở trạng thái ${p.status}` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.payoutRequest.update({
        where: { id },
        data: { status: 'REJECTED', reject_reason: reason, reviewed_at: new Date(), reviewed_by_uid: adminUid },
      });
      // Revert hold
      await tx.walletLedger.create({
        data: {
          user_id: p.user_id, type: 'PAYOUT_REVERSE', amount: p.amount_vnd,
          ref_id: p.id, note: `Hoàn rút tiền #${p.id}: ${reason}`,
        },
      });
      await writeAudit(tx, adminUid, 'REJECT_PAYOUT', 'USER', p.user_id, reason, { payout_id: id });
      return u;
    });
    res.json({ ...updated, amount_vnd: updated.amount_vnd.toString() });
  } catch (err) { handleError(res, 'Lỗi reject payout', err); }
};

export const adminCompletePayout = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const adminUid = req.user!.zaloUid;
    const adminUserId = req.user!.userId;
    const files = (req.files as { [field: string]: Express.Multer.File[] }) || {};
    const proofFile = files.proof?.[0];

    const p = await prisma.payoutRequest.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: 'Không tìm thấy' });
    if (p.user_id === adminUserId) return res.status(403).json({ error: 'CANNOT_REVIEW_OWN_PAYOUT' });
    if (p.status !== 'APPROVED') return res.status(409).json({ error: 'Chỉ COMPLETE đơn APPROVED' });

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.payoutRequest.update({
        where: { id },
        data: {
          status: 'COMPLETED', completed_at: new Date(),
          proof_url: proofFile ? toRelativeUrl(proofFile.path) : p.proof_url,
        },
      });
      await writeAudit(tx, adminUid, 'COMPLETE_PAYOUT', 'USER', p.user_id, undefined, { payout_id: id });
      return u;
    });
    res.json({ ...updated, amount_vnd: updated.amount_vnd.toString() });
  } catch (err) { handleError(res, 'Lỗi complete payout', err); }
};

// Re-export multer instance for routes
export const proofUpload = uploadKYC.fields([{ name: 'proof', maxCount: 1 }]);
