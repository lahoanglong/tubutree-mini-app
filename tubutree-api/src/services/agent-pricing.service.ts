/**
 * Agent Pricing Service — seed tiers, auto-create profile, tính giá sỉ.
 */
import prisma from '../lib/prisma';

const DEFAULT_TIERS = [
  { code: 'BRONZE', name: 'Đại lý Bronze', discount_pct: 10, min_order_vnd: BigInt(1_000_000), sort_order: 1 },
  { code: 'SILVER', name: 'Đại lý Silver', discount_pct: 15, min_order_vnd: BigInt(5_000_000), sort_order: 2 },
  { code: 'GOLD',   name: 'Đại lý Gold',   discount_pct: 20, min_order_vnd: BigInt(10_000_000), sort_order: 3 },
];

export async function seedTiersIfEmpty() {
  const count = await prisma.agentTier.count();
  if (count > 0) return;
  await prisma.agentTier.createMany({ data: DEFAULT_TIERS });
}

export async function ensureAgentProfile(userId: number) {
  await seedTiersIfEmpty();
  const existing = await prisma.agentProfile.findUnique({ where: { user_id: userId } });
  if (existing) return existing;
  const bronze = await prisma.agentTier.findUnique({ where: { code: 'BRONZE' } });
  if (!bronze) throw new Error('Default tier BRONZE chưa được seed');
  return prisma.agentProfile.create({
    data: { user_id: userId, tier_id: bronze.id },
  });
}

/** Lấy giá sỉ cho 1 retail_price (VND) theo tier của user. Trả null nếu user không phải agent. */
export async function wholesalePrice(userId: number, retailVnd: bigint | number): Promise<bigint | null> {
  const profile = await prisma.agentProfile.findUnique({
    where: { user_id: userId },
    include: { tier: true },
  });
  if (!profile || !profile.tier.is_active) return null;
  const retail = typeof retailVnd === 'bigint' ? retailVnd : BigInt(Math.floor(retailVnd));
  // integer math: retail * (10000 - pct*100) / 10000 để giữ precision 2 decimal pct
  const pctScaled = BigInt(Math.round(profile.tier.discount_pct * 100));
  return (retail * (10000n - pctScaled)) / 10000n;
}

export async function getMyAgentInfo(userId: number) {
  const profile = await prisma.agentProfile.findUnique({
    where: { user_id: userId },
    include: { tier: true },
  });
  if (!profile) return null;
  return {
    tier_code: profile.tier.code,
    tier_name: profile.tier.name,
    discount_pct: profile.tier.discount_pct,
    min_order_vnd: profile.tier.min_order_vnd.toString(),
  };
}
