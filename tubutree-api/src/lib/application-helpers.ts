/**
 * Helper logic dùng chung cho AffiliateApplication và AgentApplication.
 *
 * - Đảm bảo invariant: chỉ 1 application is_active=true mỗi loại mỗi user.
 * - Sync flag User.affiliate_enabled / agent_enabled khi approve/reject/suspend/restore.
 * - Rate limit: 1 user nộp 1 lần/24h cho mỗi loại.
 */
import prisma from './prisma';
import { Prisma } from '@prisma/client';

export type CapabilityType = 'affiliate' | 'agent';
const RATE_LIMIT_HOURS = 24;

/** Kiểm tra user đã nộp đơn trong vòng 24h chưa. */
export async function checkRateLimit(userId: number, cap: CapabilityType) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_HOURS * 3600 * 1000);
  const recent = cap === 'affiliate'
    ? await prisma.affiliateApplication.findFirst({
        where: { user_id: userId, submitted_at: { gte: cutoff } },
        orderBy: { submitted_at: 'desc' },
      })
    : await prisma.agentApplication.findFirst({
        where: { user_id: userId, submitted_at: { gte: cutoff } },
        orderBy: { submitted_at: 'desc' },
      });
  return recent;
}

/** Lấy application is_active hiện tại (nếu có). */
export async function getActiveApplication(userId: number, cap: CapabilityType) {
  if (cap === 'affiliate') {
    return prisma.affiliateApplication.findFirst({
      where: { user_id: userId, is_active: true },
    });
  }
  return prisma.agentApplication.findFirst({
    where: { user_id: userId, is_active: true },
  });
}

/** Lấy application PENDING hiện tại (chưa duyệt). */
export async function getPendingApplication(userId: number, cap: CapabilityType) {
  if (cap === 'affiliate') {
    return prisma.affiliateApplication.findFirst({
      where: { user_id: userId, status: 'PENDING' },
      orderBy: { submitted_at: 'desc' },
    });
  }
  return prisma.agentApplication.findFirst({
    where: { user_id: userId, status: 'PENDING' },
    orderBy: { submitted_at: 'desc' },
  });
}

/** Mark deactive tất cả application của user (gọi khi reject hoặc tạo bản mới). */
export async function deactivatePreviousApps(tx: Prisma.TransactionClient, userId: number, cap: CapabilityType) {
  if (cap === 'affiliate') {
    await tx.affiliateApplication.updateMany({
      where: { user_id: userId, is_active: true },
      data: { is_active: false },
    });
  } else {
    await tx.agentApplication.updateMany({
      where: { user_id: userId, is_active: true },
      data: { is_active: false },
    });
  }
}

/** Cập nhật flag enabled trên User dựa trên trạng thái active app. */
export async function syncUserFlag(tx: Prisma.TransactionClient, userId: number, cap: CapabilityType, enabled: boolean) {
  const field = cap === 'affiliate' ? { affiliate_enabled: enabled } : { agent_enabled: enabled };
  await tx.user.update({ where: { id: userId }, data: field });
}

/** Ghi audit log. */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  adminZaloUid: string,
  action: string,
  targetType: 'USER' | 'AFFILIATE_APP' | 'AGENT_APP',
  targetId: number,
  reason?: string,
  metadata?: any,
) {
  await tx.adminAuditLog.create({
    data: { admin_zalo_uid: adminZaloUid, action, target_type: targetType, target_id: targetId, reason, metadata },
  });
}
