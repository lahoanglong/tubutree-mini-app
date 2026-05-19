/**
 * Affiliate Service — Referral attribution + commission.
 */
import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';

const DEFAULT_COMMISSION_RATE_PCT = 5;       // 5%
const REFERRAL_WINDOW_DAYS = 30;
const CODE_LENGTH = 8;
const CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // bỏ I, L, O, 0, 1 cho dễ đọc

function randomCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    s += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  }
  return s;
}

async function getCommissionRatePct(tx: Prisma.TransactionClient | typeof prisma, userId: number): Promise<number> {
  const prof = await tx.affiliateProfile.findUnique({ where: { user_id: userId } });
  if (prof?.commission_rate_pct != null) return prof.commission_rate_pct;
  const s = await tx.setting.findUnique({ where: { key: 'commission.default_rate_pct' } });
  const n = s ? Number(s.value) : DEFAULT_COMMISSION_RATE_PCT;
  return isNaN(n) ? DEFAULT_COMMISSION_RATE_PCT : n;
}

/** Tạo AffiliateProfile + referral_code. Idempotent + race-safe (catch P2002). */
export async function ensureAffiliateProfile(userId: number) {
  const existing = await prisma.affiliateProfile.findUnique({ where: { user_id: userId } });
  if (existing) return existing;

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    try {
      return await prisma.affiliateProfile.create({
        data: { user_id: userId, referral_code: code },
      });
    } catch (err: any) {
      // P2002 = unique constraint violation. Có thể là code clash hoặc user_id clash.
      if (err.code === 'P2002') {
        // Nếu là user_id clash → đã có profile, return luôn
        const existed = await prisma.affiliateProfile.findUnique({ where: { user_id: userId } });
        if (existed) return existed;
        // Còn lại là code clash → thử code mới
        continue;
      }
      throw err;
    }
  }
  throw new Error('Không tạo được referral_code (8 lần collision)');
}

/** Gán referrer cho user hiện tại (last-touch trong window). */
export async function attributeReferrer(referredUserId: number, refCode: string) {
  const referrerProf = await prisma.affiliateProfile.findUnique({ where: { referral_code: refCode } });
  if (!referrerProf) throw new Error('REFERRAL_CODE_NOT_FOUND');
  if (referrerProf.user_id === referredUserId) throw new Error('SELF_REFERRAL_NOT_ALLOWED');

  const expires_at = new Date(Date.now() + REFERRAL_WINDOW_DAYS * 86400 * 1000);
  return prisma.referral.upsert({
    where: { referred_user_id: referredUserId },
    update: { referrer_user_id: referrerProf.user_id, expires_at, created_at: new Date() },
    create: { referrer_user_id: referrerProf.user_id, referred_user_id: referredUserId, expires_at },
  });
}

/** Lấy referrer hiện tại nếu chưa hết hạn. */
export async function getActiveReferrer(referredUserId: number) {
  return prisma.referral.findFirst({
    where: { referred_user_id: referredUserId, expires_at: { gt: new Date() } },
  });
}

/** Tính + ghi commission khi đơn COMPLETED. Idempotent. */
export async function awardCommissionForOrder(orderId: number, orderTotalVnd: number) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.orderRef.findUnique({ where: { id: orderId } });
    if (!order) return null;

    const ref = await tx.referral.findFirst({
      where: { referred_user_id: order.user_id, expires_at: { gt: new Date() } },
    });
    if (!ref) return null;

    // Idempotent
    const exists = await tx.commissionLedger.findFirst({
      where: { order_id: orderId, type: 'EARN' },
    });
    if (exists) return exists;

    const ratePct = await getCommissionRatePct(tx, ref.referrer_user_id);
    const commissionVnd = BigInt(Math.floor((orderTotalVnd * ratePct) / 100));
    if (commissionVnd <= 0n) return null;

    const ledger = await tx.commissionLedger.create({
      data: {
        user_id: ref.referrer_user_id,
        type: 'EARN',
        amount: commissionVnd,
        order_id: orderId,
        referred_user_id: order.user_id,
        note: `Hoa hồng ${ratePct}% đơn #${orderId}`,
      },
    });
    await tx.walletLedger.create({
      data: {
        user_id: ref.referrer_user_id,
        type: 'COMMISSION_IN',
        amount: commissionVnd,
        ref_id: ledger.id,
        note: `Hoa hồng đơn #${orderId}`,
      },
    });
    // Update profile stats
    await tx.affiliateProfile.update({
      where: { user_id: ref.referrer_user_id },
      data: {
        total_orders: { increment: 1 },
        total_commission: { increment: commissionVnd },
      },
    });
    return ledger;
  });
}

/** Reverse commission khi đơn cancel. */
export async function reverseCommissionForOrder(orderId: number) {
  return prisma.$transaction(async (tx) => {
    const earns = await tx.commissionLedger.findMany({
      where: { order_id: orderId, type: 'EARN' },
    });
    for (const e of earns) {
      // Skip nếu đã reverse
      const rev = await tx.commissionLedger.findFirst({
        where: { order_id: orderId, type: 'REVERSE', user_id: e.user_id },
      });
      if (rev) continue;

      const negAmount = -e.amount;
      await tx.commissionLedger.create({
        data: {
          user_id: e.user_id,
          type: 'REVERSE',
          amount: negAmount,
          order_id: orderId,
          referred_user_id: e.referred_user_id,
          note: `Hoàn hoa hồng do huỷ đơn #${orderId}`,
        },
      });
      await tx.walletLedger.create({
        data: {
          user_id: e.user_id,
          type: 'COMMISSION_REVERSE',
          amount: negAmount,
          ref_id: e.id,
          note: `Huỷ đơn #${orderId}`,
        },
      });
      await tx.affiliateProfile.update({
        where: { user_id: e.user_id },
        data: {
          total_orders: { decrement: 1 },
          total_commission: { increment: negAmount },
        },
      });
    }
    return earns.length;
  });
}

/** Wallet balance VND. */
export async function getWalletBalance(userId: number): Promise<bigint> {
  const r = await prisma.walletLedger.aggregate({
    where: { user_id: userId },
    _sum: { amount: true },
  });
  return r._sum.amount || 0n;
}
