/**
 * Points Service — Logic tích điểm + redeem.
 *
 * Balance = SUM(PointsLedger.amount) — không cache để tránh sync issue.
 * Settings load từ bảng Setting (key=points.*).
 */
import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';

const DEFAULTS = {
  earn_per_vnd: 0.001,   // 1 point / 1000 VND
  vnd_per_point: 100,    // 1 point = 100 VND
  min_redeem: 100,       // tối thiểu redeem
  max_redeem_pct: 50,    // tối đa 50% giá trị đơn
};

async function getSetting(key: string, fallback: number): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key } });
  if (!s) return fallback;
  const n = Number(s.value);
  return isNaN(n) ? fallback : n;
}

export async function getConfig() {
  const [earn_per_vnd, vnd_per_point, min_redeem, max_redeem_pct] = await Promise.all([
    getSetting('points.earn_per_vnd', DEFAULTS.earn_per_vnd),
    getSetting('points.vnd_per_point', DEFAULTS.vnd_per_point),
    getSetting('points.min_redeem', DEFAULTS.min_redeem),
    getSetting('points.max_redeem_pct', DEFAULTS.max_redeem_pct),
  ]);
  return { earn_per_vnd, vnd_per_point, min_redeem, max_redeem_pct };
}

/** Số dư hiện tại. */
export async function getBalance(userId: number): Promise<number> {
  const r = await prisma.pointsLedger.aggregate({
    where: { user_id: userId },
    _sum: { amount: true },
  });
  return r._sum.amount || 0;
}

/** Tổng lifetime earn + redeem. */
export async function getLifetime(userId: number) {
  const [earnSum, redeemSum] = await Promise.all([
    prisma.pointsLedger.aggregate({
      where: { user_id: userId, type: { in: ['EARN'] }, amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.pointsLedger.aggregate({
      where: { user_id: userId, type: { in: ['REDEEM'] }, amount: { lt: 0 } },
      _sum: { amount: true },
    }),
  ]);
  return {
    earned: earnSum._sum.amount || 0,
    redeemed: Math.abs(redeemSum._sum.amount || 0),
  };
}

/** Tính số point được cộng từ giá trị đơn. */
export async function pointsFromOrderValue(orderTotalVnd: number): Promise<number> {
  const { earn_per_vnd } = await getConfig();
  return Math.floor(orderTotalVnd * earn_per_vnd);
}

/** Convert point → VND giảm giá. */
export async function pointsToVnd(points: number): Promise<number> {
  const { vnd_per_point } = await getConfig();
  return points * vnd_per_point;
}

/** Tính discount preview khi user muốn redeem. Trả về null nếu không hợp lệ. */
export async function previewRedeem(userId: number, pointsToRedeem: number, orderTotalVnd: number) {
  const cfg = await getConfig();
  const balance = await getBalance(userId);

  if (pointsToRedeem < cfg.min_redeem) {
    return { valid: false, error: `Tối thiểu ${cfg.min_redeem} điểm`, max_allowed: 0, discount_vnd: 0 };
  }
  if (pointsToRedeem > balance) {
    return { valid: false, error: `Không đủ điểm (đang có ${balance})`, max_allowed: balance, discount_vnd: 0 };
  }
  const maxDiscount = Math.floor(orderTotalVnd * cfg.max_redeem_pct / 100);
  const maxPoints = Math.floor(maxDiscount / cfg.vnd_per_point);
  if (pointsToRedeem > maxPoints) {
    return { valid: false, error: `Tối đa ${maxPoints} điểm cho đơn này (${cfg.max_redeem_pct}%)`, max_allowed: maxPoints, discount_vnd: 0 };
  }
  return { valid: true, discount_vnd: pointsToRedeem * cfg.vnd_per_point, max_allowed: maxPoints };
}

/** Cộng điểm khi đơn hàng COMPLETED. Idempotent. */
export async function awardForOrder(orderId: number, orderTotalVnd: number) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.orderRef.findUnique({ where: { id: orderId } });
    if (!order) throw new Error(`OrderRef ${orderId} not found`);

    // Idempotent: nếu đã có entry EARN cho order này thì skip
    const existing = await tx.pointsLedger.findFirst({
      where: { order_id: orderId, type: 'EARN' },
    });
    if (existing) return existing;

    const points = await pointsFromOrderValue(orderTotalVnd);
    if (points <= 0) return null;

    return tx.pointsLedger.create({
      data: {
        user_id: order.user_id,
        type: 'EARN',
        amount: points,
        order_id: orderId,
        note: `Tích điểm cho đơn #${orderId} (${orderTotalVnd.toLocaleString()} VND)`,
      },
    });
  });
}

/** Trừ điểm khi user redeem. Trả về ledger entry. */
export async function redeemPoints(
  tx: Prisma.TransactionClient,
  userId: number,
  pointsToRedeem: number,
  orderId: number,
) {
  // Check balance lần nữa trong transaction (lock-free, hy vọng row-level)
  const balanceAgg = await tx.pointsLedger.aggregate({
    where: { user_id: userId },
    _sum: { amount: true },
  });
  const balance = balanceAgg._sum.amount || 0;
  if (pointsToRedeem > balance) {
    throw new Error(`Không đủ điểm (đang có ${balance}, cần ${pointsToRedeem})`);
  }

  return tx.pointsLedger.create({
    data: {
      user_id: userId,
      type: 'REDEEM',
      amount: -pointsToRedeem,
      order_id: orderId,
      note: `Dùng ${pointsToRedeem} điểm cho đơn #${orderId}`,
    },
  });
}

/** Reverse khi đơn cancel. */
export async function reverseForOrder(orderId: number) {
  return prisma.$transaction(async (tx) => {
    const entries = await tx.pointsLedger.findMany({
      where: { order_id: orderId, type: { in: ['EARN', 'REDEEM'] } },
    });
    if (entries.length === 0) return [];

    // Idempotent: nếu đã có REVERSE entries cho order này thì skip
    const existingReverses = await tx.pointsLedger.findMany({
      where: { order_id: orderId, type: { in: ['REVERSE_EARN', 'REVERSE_REDEEM'] } },
    });
    if (existingReverses.length >= entries.length) return [];

    // Sequential — Prisma interactive tx không an toàn cho parallel awaits
    const reversals = [];
    for (const e of entries) {
      const rev = await tx.pointsLedger.create({
        data: {
          user_id: e.user_id,
          type: e.type === 'EARN' ? 'REVERSE_EARN' : 'REVERSE_REDEEM',
          amount: -e.amount,
          order_id: orderId,
          note: `Hoàn điểm: huỷ đơn #${orderId}`,
        },
      });
      reversals.push(rev);
    }
    return reversals;
  });
}
