/**
 * Agent Application Controller — user nộp/sửa đơn Đại lý.
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getUserId, handleError } from '../lib/helpers';
import {
  checkRateLimit, getActiveApplication, deactivatePreviousApps,
} from '../lib/application-helpers';
import { toRelativeUrl } from '../lib/upload';

function validateAgent(body: any) {
  const required = ['cccd_number', 'bank_name', 'bank_account_no', 'bank_account_name',
                    'warehouse_address', 'expected_monthly_revenue', 'agent_type'];
  for (const f of required) {
    if (body[f] === undefined || body[f] === null || String(body[f]).trim() === '') return `Thiếu trường: ${f}`;
  }
  if (!['INDIVIDUAL', 'BUSINESS'].includes(body.agent_type)) return 'agent_type chỉ nhận INDIVIDUAL hoặc BUSINESS';
  if (!/^\d{9,12}$/.test(body.cccd_number)) return 'CCCD phải có 9-12 chữ số';
  if (isNaN(Number(body.expected_monthly_revenue)) || Number(body.expected_monthly_revenue) <= 0) {
    return 'expected_monthly_revenue phải là số > 0';
  }
  return null;
}

export const submitAgentApplication = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const files = (req.files as { [field: string]: Express.Multer.File[] }) || {};
    const body = req.body;

    const err = validateAgent(body);
    if (err) return res.status(400).json({ error: err });

    const required = ['cccd_front', 'cccd_back', 'selfie'];
    for (const f of required) {
      if (!files[f]?.[0]) return res.status(400).json({ error: `Thiếu ảnh: ${f}` });
    }

    const active = await getActiveApplication(userId, 'agent');
    if (active && active.status === 'APPROVED') {
      return res.status(409).json({ error: 'ALREADY_APPROVED' });
    }
    if (active && active.status === 'PENDING') {
      return res.status(409).json({ error: 'PENDING_REVIEW' });
    }
    if (active && active.status === 'SUSPENDED') {
      return res.status(409).json({ error: 'SUSPENDED' });
    }

    const recent = await checkRateLimit(userId, 'agent');
    if (recent) return res.status(429).json({ error: 'TOO_FREQUENT' });

    const result = await prisma.$transaction(async (tx) => {
      await deactivatePreviousApps(tx, userId, 'agent');
      return tx.agentApplication.create({
        data: {
          user_id: userId,
          status: 'PENDING',
          is_active: true,
          agent_type: body.agent_type,
          cccd_number: body.cccd_number,
          cccd_front_url: toRelativeUrl(files.cccd_front[0].path),
          cccd_back_url: toRelativeUrl(files.cccd_back[0].path),
          selfie_url: toRelativeUrl(files.selfie[0].path),
          warehouse_address: body.warehouse_address,
          expected_monthly_revenue: body.expected_monthly_revenue,
          bank_name: body.bank_name,
          bank_account_no: body.bank_account_no,
          bank_account_name: body.bank_account_name,
          email: body.email || null,
          company_name: body.company_name || null,
          tax_code: body.tax_code || null,
          business_license_url: files.business_license?.[0]
            ? toRelativeUrl(files.business_license[0].path)
            : null,
          representative_name: body.representative_name || null,
        },
      });
    });

    res.status(201).json(result);
  } catch (err) {
    handleError(res, 'Lỗi nộp đơn Đại lý', err);
  }
};

export const getMyAgentApplication = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const [active, history] = await Promise.all([
      prisma.agentApplication.findFirst({ where: { user_id: userId, is_active: true } }),
      prisma.agentApplication.findMany({
        where: { user_id: userId, is_active: false },
        orderBy: { submitted_at: 'desc' },
        take: 10,
      }),
    ]);
    res.json({ active, history });
  } catch (err) {
    handleError(res, 'Lỗi lấy đơn Đại lý', err);
  }
};

export const updateMyAgentApplication = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const body = req.body;

    const active = await getActiveApplication(userId, 'agent');
    if (!active) return res.status(404).json({ error: 'Chưa có đơn nào' });
    if (active.status !== 'PENDING' && active.status !== 'APPROVED') {
      return res.status(409).json({ error: `Không thể sửa đơn ở trạng thái ${active.status}` });
    }

    const data: any = {};
    const allowedAlways = ['bank_name', 'bank_account_no', 'bank_account_name', 'email',
                           'warehouse_address', 'company_name', 'tax_code', 'representative_name'];
    const allowedPending = ['cccd_number', 'agent_type', 'expected_monthly_revenue'];

    for (const f of allowedAlways) if (body[f] !== undefined) data[f] = body[f];
    if (active.status === 'PENDING') {
      for (const f of allowedPending) if (body[f] !== undefined) data[f] = body[f];

      const files = (req.files as { [field: string]: Express.Multer.File[] }) || {};
      if (files.cccd_front?.[0]) data.cccd_front_url = toRelativeUrl(files.cccd_front[0].path);
      if (files.cccd_back?.[0]) data.cccd_back_url = toRelativeUrl(files.cccd_back[0].path);
      if (files.selfie?.[0]) data.selfie_url = toRelativeUrl(files.selfie[0].path);
      if (files.business_license?.[0]) data.business_license_url = toRelativeUrl(files.business_license[0].path);
    }

    const updated = await prisma.agentApplication.update({ where: { id: active.id }, data });
    res.json(updated);
  } catch (err) {
    handleError(res, 'Lỗi cập nhật đơn Đại lý', err);
  }
};
