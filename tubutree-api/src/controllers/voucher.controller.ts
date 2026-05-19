/**
 * Voucher Controller — apply preview + CRUD admin.
 */
import { Response } from 'express';
import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getUserId, handleError, toInt, getPagination } from '../lib/helpers';

/** Tính discount cho 1 voucher với order_total. Pure function, dùng được từ order create. */
export function computeVoucherDiscount(v: { type: string; percent_value: number | null; fixed_amount_vnd: bigint | null; value: number; max_discount_vnd: bigint | null }, orderTotal: bigint): bigint {
  if (v.type === 'PERCENT') {
    const pct = v.percent_value ?? v.value; // fallback legacy
    // BigInt math: orderTotal * pct(int) / 100, dùng integer math để tránh float
    // pct có thể là decimal (vd 12.5) → quy đổi: discount = floor(orderTotal * pct*100 / 10000)
    const scaledPct = BigInt(Math.round(pct * 100)); // 12.5% → 1250
    let discount = (orderTotal * scaledPct) / 10000n;
    if (v.max_discount_vnd != null && discount > v.max_discount_vnd) discount = v.max_discount_vnd;
    return discount;
  }
  if (v.type === 'FIXED') {
    const fixed = v.fixed_amount_vnd ?? BigInt(Math.floor(v.value));
    return fixed > orderTotal ? orderTotal : fixed;
  }
  return 0n;
}

/**
 * Consume 1 voucher cho 1 order. Gọi trong order-create transaction.
 * - Re-validate (re-check vì state có thể đổi giữa preview và consume)
 * - Tăng used_count + tạo VoucherUsage
 * - Trả về { discount_vnd, voucher_id }
 *
 * Throw nếu không hợp lệ — caller phải rollback.
 */
export async function consumeVoucher(
  tx: Prisma.TransactionClient,
  code: string,
  userId: number,
  orderTotal: bigint,
  orderId: number,
): Promise<{ discount_vnd: bigint; voucher_id: number }> {
  const v = await tx.voucher.findUnique({ where: { code } });
  if (!v) throw new Error('VOUCHER_NOT_FOUND');
  if (!v.is_active) throw new Error('VOUCHER_INACTIVE');
  const now = new Date();
  if (now < v.valid_from || now > v.valid_to) throw new Error('VOUCHER_OUT_OF_WINDOW');
  if (v.total_uses != null && v.used_count >= v.total_uses) throw new Error('VOUCHER_EXHAUSTED');
  if (orderTotal < v.min_order_vnd) throw new Error('VOUCHER_BELOW_MIN_ORDER');

  const userCount = await tx.voucherUsage.count({ where: { voucher_id: v.id, user_id: userId } });
  if (userCount >= v.per_user_uses) throw new Error('VOUCHER_PER_USER_LIMIT');

  const discount = computeVoucherDiscount(v, orderTotal);
  if (discount <= 0n) throw new Error('VOUCHER_NO_DISCOUNT');

  await tx.voucherUsage.create({
    data: { voucher_id: v.id, user_id: userId, order_id: orderId, discount_vnd: discount },
  });
  await tx.voucher.update({
    where: { id: v.id },
    data: { used_count: { increment: 1 } },
  });
  return { discount_vnd: discount, voucher_id: v.id };
}

/** Validate voucher có thể dùng cho order này không. Return error string hoặc null nếu OK. */
export async function validateVoucherForUser(code: string, userId: number, orderTotal: bigint) {
  const v = await prisma.voucher.findUnique({ where: { code } });
  if (!v) return { error: 'Mã không tồn tại' };
  if (!v.is_active) return { error: 'Mã đã ngừng hoạt động' };
  const now = new Date();
  if (now < v.valid_from) return { error: 'Mã chưa có hiệu lực' };
  if (now > v.valid_to) return { error: 'Mã đã hết hạn' };
  if (v.total_uses != null && v.used_count >= v.total_uses) {
    return { error: 'Mã đã hết lượt dùng' };
  }
  if (orderTotal < v.min_order_vnd) {
    return { error: `Đơn tối thiểu ${v.min_order_vnd.toString()} VND` };
  }
  const userCount = await prisma.voucherUsage.count({
    where: { voucher_id: v.id, user_id: userId },
  });
  if (userCount >= v.per_user_uses) {
    return { error: `Mỗi user dùng tối đa ${v.per_user_uses} lần` };
  }
  return { voucher: v };
}

// ===== USER =====
export const applyVoucher = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const code = String(req.body.code || '').toUpperCase().trim();
    if (!code) return res.status(400).json({ error: 'Thiếu code' });
    if (req.body.order_total == null || !/^\d+$/.test(String(req.body.order_total))) {
      return res.status(400).json({ error: 'order_total phải là số nguyên dương' });
    }
    const orderTotal = BigInt(req.body.order_total);

    const result = await validateVoucherForUser(code, userId, orderTotal);
    if ('error' in result) return res.json({ valid: false, error: result.error });

    const discount = computeVoucherDiscount(result.voucher, orderTotal);
    res.json({ valid: true, voucher_id: result.voucher.id, code: result.voucher.code, discount_vnd: discount.toString() });
  } catch (err) { handleError(res, 'Lỗi apply voucher', err); }
};

export const listActiveVouchers = async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const items = await prisma.voucher.findMany({
      where: { is_active: true, valid_from: { lte: now }, valid_to: { gte: now } },
      orderBy: { valid_to: 'asc' },
    });
    res.json(items.map(serializeVoucher));
  } catch (err) { handleError(res, 'Lỗi list vouchers', err); }
};

// ===== ADMIN =====
export const adminListVouchers = async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const [items, total] = await Promise.all([
      prisma.voucher.findMany({ orderBy: { created_at: 'desc' }, skip, take: limit }),
      prisma.voucher.count(),
    ]);
    res.json({ data: items.map(serializeVoucher), total, page, limit });
  } catch (err) { handleError(res, 'Lỗi list', err); }
};

function validateVoucherInput(b: any): string | null {
  if (!['PERCENT', 'FIXED'].includes(b.type)) return 'type chỉ là PERCENT|FIXED';
  const v = Number(b.value);
  if (isNaN(v) || v <= 0) return 'value phải > 0';
  if (b.type === 'PERCENT' && v > 100) return 'PERCENT value phải <= 100';
  if (b.type === 'FIXED' && v > 1e12) return 'FIXED value quá lớn';
  if (b.per_user_uses != null && Number(b.per_user_uses) < 1) return 'per_user_uses phải >= 1';
  if (b.total_uses != null && Number(b.total_uses) < 1) return 'total_uses phải >= 1';
  if (b.min_order_vnd != null && BigInt(b.min_order_vnd) < 0n) return 'min_order_vnd phải >= 0';
  if (b.max_discount_vnd != null && BigInt(b.max_discount_vnd) <= 0n) return 'max_discount_vnd phải > 0';
  const from = new Date(b.valid_from);
  const to = new Date(b.valid_to);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 'valid_from/valid_to không hợp lệ';
  if (to <= from) return 'valid_to phải sau valid_from';
  return null;
}

export const adminCreateVoucher = async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body;
    const required = ['code', 'description', 'type', 'value', 'valid_from', 'valid_to'];
    for (const f of required) if (!b[f]) return res.status(400).json({ error: `Thiếu ${f}` });

    const errMsg = validateVoucherInput(b);
    if (errMsg) return res.status(400).json({ error: errMsg });

    const numVal = Number(b.value);
    const v = await prisma.voucher.create({
      data: {
        code: String(b.code).toUpperCase(),
        description: b.description,
        type: b.type,
        value: numVal, // legacy mirror
        percent_value: b.type === 'PERCENT' ? numVal : null,
        fixed_amount_vnd: b.type === 'FIXED' ? BigInt(Math.floor(numVal)) : null,
        max_discount_vnd: b.max_discount_vnd != null ? BigInt(b.max_discount_vnd) : null,
        min_order_vnd: b.min_order_vnd != null ? BigInt(b.min_order_vnd) : 0n,
        total_uses: b.total_uses ?? null,
        per_user_uses: b.per_user_uses ?? 1,
        valid_from: new Date(b.valid_from),
        valid_to: new Date(b.valid_to),
        is_active: b.is_active !== false,
      },
    });
    res.status(201).json(serializeVoucher(v));
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Code đã tồn tại' });
    handleError(res, 'Lỗi tạo voucher', err);
  }
};

export const adminUpdateVoucher = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const b = req.body;

    // Nếu update value hoặc type → validate trên merged state
    if (b.value !== undefined || b.type !== undefined) {
      const current = await prisma.voucher.findUnique({ where: { id } });
      if (!current) return res.status(404).json({ error: 'Không tìm thấy voucher' });
      const merged = { ...current, ...b, value: b.value ?? current.value, type: b.type ?? current.type };
      const errMsg = validateVoucherInput(merged);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }

    const data: any = {};
    ['description', 'type', 'is_active', 'per_user_uses', 'total_uses'].forEach(k => {
      if (b[k] !== undefined) data[k] = b[k];
    });
    if (b.value !== undefined) data.value = Number(b.value);
    if (b.max_discount_vnd !== undefined) data.max_discount_vnd = b.max_discount_vnd == null ? null : BigInt(b.max_discount_vnd);
    if (b.min_order_vnd !== undefined) data.min_order_vnd = BigInt(b.min_order_vnd);
    if (b.valid_from) data.valid_from = new Date(b.valid_from);
    if (b.valid_to) data.valid_to = new Date(b.valid_to);
    const v = await prisma.voucher.update({ where: { id }, data });
    res.json(serializeVoucher(v));
  } catch (err) { handleError(res, 'Lỗi update', err); }
};

export const adminDeactivateVoucher = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const v = await prisma.voucher.update({ where: { id }, data: { is_active: false } });
    res.json(serializeVoucher(v));
  } catch (err) { handleError(res, 'Lỗi deactivate', err); }
};

export const adminListUsages = async (req: AuthRequest, res: Response) => {
  try {
    const id = toInt(req.params.id);
    const { page, limit, skip } = getPagination(req.query);
    const [items, total] = await Promise.all([
      prisma.voucherUsage.findMany({
        where: { voucher_id: id }, orderBy: { used_at: 'desc' }, skip, take: limit,
      }),
      prisma.voucherUsage.count({ where: { voucher_id: id } }),
    ]);
    res.json({
      data: items.map(i => ({ ...i, discount_vnd: i.discount_vnd.toString() })),
      total, page, limit,
    });
  } catch (err) { handleError(res, 'Lỗi list usages', err); }
};

function serializeVoucher(v: any) {
  return {
    ...v,
    max_discount_vnd: v.max_discount_vnd?.toString() ?? null,
    min_order_vnd: v.min_order_vnd.toString(),
    fixed_amount_vnd: v.fixed_amount_vnd?.toString() ?? null,
  };
}
