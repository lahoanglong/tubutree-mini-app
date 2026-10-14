import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { StaffPermission } from '../../common/staff-permissions';
import { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';
import { pancakeUnsyncedWhere, recyclingAttentionWhere } from '../admin/admin-order-filter';

export type InboxKey =
  | 'pancakeAttention'
  | 'pancakeUnsynced'
  | 'gomdonAttention'
  | 'customerRefunds'
  | 'returnsPending'
  | 'returnsToReceive'
  | 'merchantOverdue'
  | 'merchantProducts'
  | 'dealerApplications'
  | 'dealerClaims'
  | 'payouts'
  | 'refillPending';

/** Ai thấy việc này ngoài ADMIN: nhóm việc của nhân viên, hoặc 'STAFF' = mọi nhân viên (route vốn mở cho STAFF). */
type Audience = StaffPermission[] | 'STAFF' | 'ADMIN';

export interface InboxViewer {
  role: string;
  staffPermissions?: string[];
}

/**
 * "Việc cần xử lý" (ADMINOPS-13): số việc đang chờ ở từng hàng đợi đã có sẵn trên web admin. Đếm thẳng từ đúng
 * điều kiện các tab đang lọc (cùng hàm where) nên số trên trang chủ khớp số dòng khi bấm vào.
 */
@Injectable()
export class OpsInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchant: MerchantFulfilmentService,
  ) {}

  private defs(now: Date): { key: InboxKey; audience: Audience; count: () => Promise<number> }[] {
    const p = this.prisma;
    return [
      { key: 'pancakeAttention', audience: ['KHO'], count: () => p.order.count({ where: { pancakeAttentionAt: { not: null } } }) },
      { key: 'pancakeUnsynced', audience: ['KHO'], count: () => p.order.count({ where: pancakeUnsyncedWhere(now) }) },
      { key: 'gomdonAttention', audience: ['KHO'], count: () => p.order.count({ where: recyclingAttentionWhere() }) },
      { key: 'customerRefunds', audience: 'ADMIN', count: () => p.orderCustomerRefund.count({ where: { status: 'PENDING' } }) },
      { key: 'returnsPending', audience: ['CSKH'], count: () => p.returnRequest.count({ where: { status: 'REQUESTED' } }) },
      {
        key: 'returnsToReceive',
        audience: ['KHO'],
        // Hàng trả của đơn gian hàng tự giao về kho đối tác, không về kho Tubu.
        count: async () => {
          const [row] = await p.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS "n" FROM "return_requests" rr JOIN "orders" o ON o."id" = rr."orderId"
             WHERE rr."status" = 'APPROVED' AND rr."receivedAt" IS NULL AND o."fulfiller" <> 'MERCHANT'`;
          return row?.n ?? 0;
        },
      },
      { key: 'merchantOverdue', audience: 'ADMIN', count: () => this.merchant.countOverdue(now) },
      { key: 'merchantProducts', audience: 'ADMIN', count: () => p.product.count({ where: { approvalStatus: 'PENDING_REVIEW' } }) },
      { key: 'dealerApplications', audience: 'ADMIN', count: () => p.dealerApplication.count({ where: { status: 'PENDING' } }) },
      { key: 'dealerClaims', audience: 'ADMIN', count: () => p.dealerRewardClaim.count({ where: { status: 'PENDING' } }) },
      { key: 'payouts', audience: 'ADMIN', count: () => p.payout.count({ where: { status: 'REQUESTED' } }) },
      { key: 'refillPending', audience: 'STAFF', count: () => p.bottleReturn.count({ where: { status: 'PENDING' } }) },
    ];
  }

  async counts(viewer: InboxViewer, now = new Date()): Promise<{ generatedAt: string; items: { key: InboxKey; count: number }[] }> {
    const perms = viewer.staffPermissions ?? [];
    const visible = this.defs(now).filter(
      (d) =>
        viewer.role === 'ADMIN' ||
        (viewer.role === 'STAFF' && (d.audience === 'STAFF' || (Array.isArray(d.audience) && d.audience.some((a) => perms.includes(a))))),
    );
    const counts = await Promise.all(visible.map((d) => d.count()));
    return { generatedAt: now.toISOString(), items: visible.map((d, i) => ({ key: d.key, count: counts[i] ?? 0 })) };
  }
}
