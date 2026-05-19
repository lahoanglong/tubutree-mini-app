/**
 * Affiliate Application Controller — user nộp/sửa đơn CTV.
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getUserId, handleError } from '../lib/helpers';
import {
  checkRateLimit, getActiveApplication, getPendingApplication, deactivatePreviousApps,
  writeAudit,
} from '../lib/application-helpers';
import { toRelativeUrl } from '../lib/upload';

function validateBank(body: any) {
  const required = ['cccd_number', 'bank_name', 'bank_account_no', 'bank_account_name'];
  for (const f of required) {
    if (!body[f] || String(body[f]).trim() === '') return `Thiếu trường: ${f}`;
  }
  if (!/^\d{9,12}$/.test(body.cccd_number)) return 'CCCD phải có 9-12 chữ số';
  return null;
}

/** Nộp đơn mới (sau khi REJECTED hoặc lần đầu). */
export const submitAffiliateApplication = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const files = (req.files as { [field: string]: Express.Multer.File[] }) || {};
    const body = req.body;

    const cccdFrontFile = files.cccd_front?.[0];
    if (!cccdFrontFile) return res.status(400).json({ error: 'Thiếu ảnh CCCD mặt trước' });

    const err = validateBank(body);
    if (err) return res.status(400).json({ error: err });

    // Đã có application active → chặn (phải tự rút trước, mà self-withdraw chưa làm)
    const active = await getActiveApplication(userId, 'affiliate');
    if (active && active.status === 'APPROVED') {
      return res.status(409).json({ error: 'ALREADY_APPROVED', message: 'Bạn đã là CTV. Dùng PUT để cập nhật info.' });
    }
    if (active && active.status === 'PENDING') {
      return res.status(409).json({ error: 'PENDING_REVIEW', message: 'Đơn của bạn đang chờ duyệt.' });
    }
    if (active && active.status === 'SUSPENDED') {
      return res.status(409).json({ error: 'SUSPENDED', message: 'Tài khoản CTV của bạn đang bị tạm ngưng. Liên hệ admin.' });
    }

    // Rate limit
    const recent = await checkRateLimit(userId, 'affiliate');
    if (recent) {
      return res.status(429).json({ error: 'TOO_FREQUENT', message: 'Bạn chỉ có thể nộp 1 đơn / 24h.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      await deactivatePreviousApps(tx, userId, 'affiliate');
      return tx.affiliateApplication.create({
        data: {
          user_id: userId,
          status: 'PENDING',
          is_active: true,
          cccd_number: body.cccd_number,
          cccd_front_url: toRelativeUrl(cccdFrontFile.path),
          bank_name: body.bank_name,
          bank_account_no: body.bank_account_no,
          bank_account_name: body.bank_account_name,
          email: body.email || null,
        },
      });
    });

    res.status(201).json(result);
  } catch (err) {
    handleError(res, 'Lỗi nộp đơn CTV', err);
  }
};

/** Xem đơn hiện tại + history. */
export const getMyAffiliateApplication = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const [active, history] = await Promise.all([
      prisma.affiliateApplication.findFirst({ where: { user_id: userId, is_active: true } }),
      prisma.affiliateApplication.findMany({
        where: { user_id: userId, is_active: false },
        orderBy: { submitted_at: 'desc' },
        take: 10,
      }),
    ]);
    res.json({ active, history });
  } catch (err) {
    handleError(res, 'Lỗi lấy đơn CTV', err);
  }
};

/** Cập nhật info đơn PENDING (chưa duyệt). Hoặc cập nhật bank cho đơn APPROVED. */
export const updateMyAffiliateApplication = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const body = req.body;

    const active = await getActiveApplication(userId, 'affiliate');
    if (!active) return res.status(404).json({ error: 'Chưa có đơn nào' });

    if (active.status !== 'PENDING' && active.status !== 'APPROVED') {
      return res.status(409).json({ error: `Không thể sửa đơn ở trạng thái ${active.status}` });
    }

    // Khi PENDING — cho phép sửa hết. Khi APPROVED — chỉ cho sửa bank info.
    const data: any = {};
    const bankFields = ['bank_name', 'bank_account_no', 'bank_account_name'];
    const allowedAlways = [...bankFields, 'email'];
    const allowedPending = ['cccd_number'];

    // Track bank info changes để audit
    const bankChanges: Record<string, { from: string; to: string }> = {};
    for (const f of allowedAlways) {
      if (body[f] !== undefined && body[f] !== (active as any)[f]) {
        data[f] = body[f];
        if (bankFields.includes(f) && active.status === 'APPROVED') {
          bankChanges[f] = { from: (active as any)[f], to: body[f] };
        }
      }
    }
    if (active.status === 'PENDING') {
      for (const f of allowedPending) if (body[f] !== undefined) data[f] = body[f];

      const files = (req.files as { [field: string]: Express.Multer.File[] }) || {};
      if (files.cccd_front?.[0]) data.cccd_front_url = toRelativeUrl(files.cccd_front[0].path);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.affiliateApplication.update({
        where: { id: active.id },
        data,
      });
      // Audit nếu bank info bị đổi trên APPROVED app
      if (Object.keys(bankChanges).length > 0) {
        await writeAudit(
          tx, req.user!.zaloUid, 'USER_CHANGED_BANK_ON_APPROVED_AFFILIATE',
          'AFFILIATE_APP', active.id,
          'CTV tự đổi bank info trên đơn đã duyệt',
          bankChanges,
        );
      }
      return u;
    });
    res.json(updated);
  } catch (err) {
    handleError(res, 'Lỗi cập nhật đơn CTV', err);
  }
};
