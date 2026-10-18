import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMUNITY_MODERATORS, type StaffPermission } from '../../common/staff-permissions';
import { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';
import { PENDING_MERCHANT_PRODUCT_WHERE } from '../merchant/merchant-product-review';
import { CONSIGNMENT_PENDING_LINK_WHERE } from '../merchant/merchant-pancake-link';
import { buildAdminOrderWhere, pancakeUnsyncedWhere, recyclingAttentionWhere } from '../admin/admin-order-filter';
import { OPEN_CUSTOMER_REFUND_STATUSES } from '../orders/refund-queue';
import { countUnansweredQuestions, DEFAULT_UNANSWERED_ALERT_HOURS, UNANSWERED_ALERT_HOURS_KEY, unansweredCutoff } from '../feed/community-unanswered';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  WASTE_PERKS_PENDING_WHERE,
  WASTE_POINTS_PENDING_WHERE,
  WASTE_TO_COUNT_WHERE,
  WASTE_UNMATCHED_OPEN_WHERE,
  wasteCustomerBlockedWhere,
  wasteGiftOverdueWhere,
  wasteOrderMismatchWhere,
  wasteTransitOverdueWhere,
} from '../waste-exchange/core/waste-queue-filters';

export type InboxKey =
  | 'pancakeAttention'
  | 'pancakeUnsynced'
  | 'gomdonAttention'
  | 'customerRefunds'
  | 'returnsPending'
  | 'returnsToReceive'
  | 'merchantOverdue'
  | 'merchantProducts'
  | 'consignmentPending'
  | 'merchantToSettle'
  | 'merchantPayoutsPending'
  | 'dealerApplications'
  | 'dealerClaims'
  | 'payouts'
  | 'communityPending'
  | 'communityUnanswered'
  | 'invoicePending'
  | 'wasteToCount'
  | 'wasteUnmatched'
  | 'wasteBlockedPending'
  | 'wastePointsPending'
  | 'wastePerksPending'
  | 'wasteTransitOverdue'
  | 'wasteGiftOverdue'
  | 'wasteOrderMismatch';

/** Ai thấy việc này ngoài ADMIN: nhóm việc của nhân viên, hoặc 'STAFF' = mọi nhân viên (route vốn mở cho STAFF). */
type Audience = readonly StaffPermission[] | 'STAFF' | 'ADMIN';

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
    // Optional: chỉ để đọc `community.unanswered_alert_hours` và `waste.in_transit_review_days`; thiếu thì dùng mặc định trong mã.
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  private defs(now: Date): { key: InboxKey; audience: Audience; count: () => Promise<number> }[] {
    const p = this.prisma;
    return [
      { key: 'pancakeAttention', audience: ['KHO'], count: () => p.order.count({ where: { pancakeAttentionAt: { not: null } } }) },
      { key: 'pancakeUnsynced', audience: ['KHO'], count: () => p.order.count({ where: pancakeUnsyncedWhere(now) }) },
      { key: 'gomdonAttention', audience: ['KHO'], count: () => p.order.count({ where: recyclingAttentionWhere() }) },
      { key: 'customerRefunds', audience: ['KE_TOAN'], count: () => p.orderCustomerRefund.count({ where: { status: { in: [...OPEN_CUSTOMER_REFUND_STATUSES] } } }) },
      { key: 'returnsPending', audience: ['CSKH'], count: () => p.returnRequest.count({ where: { status: 'REQUESTED' } }) },
      {
        key: 'returnsToReceive',
        audience: ['KHO'],
        // Hàng trả của đơn gian hàng tự giao về kho đối tác, không về kho Tubu. Yêu cầu không có dòng hàng là yêu cầu cũ trước P5 (đã
        // cộng kho lúc duyệt): không có gì để "nhận về".
        count: async () => {
          const [row] = await p.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS "n" FROM "return_requests" rr JOIN "orders" o ON o."id" = rr."orderId"
             WHERE rr."status" = 'APPROVED' AND rr."receivedAt" IS NULL AND o."fulfiller" <> 'MERCHANT'
               AND EXISTS (SELECT 1 FROM "return_request_items" i WHERE i."returnRequestId" = rr."id")`;
          return row?.n ?? 0;
        },
      },
      { key: 'merchantOverdue', audience: 'ADMIN', count: () => this.merchant.countOverdue(now) },
      { key: 'merchantProducts', audience: 'ADMIN', count: () => p.product.count({ where: PENDING_MERCHANT_PRODUCT_WHERE }) },
      { key: 'consignmentPending', audience: 'ADMIN', count: () => p.merchantPancakeLink.count({ where: CONSIGNMENT_PENDING_LINK_WHERE }) },
      { key: 'merchantToSettle', audience: ['KE_TOAN'], count: () => this.merchant.countStoresToSettle(now) },
      { key: 'merchantPayoutsPending', audience: ['KE_TOAN'], count: () => p.merchantPayout.count({ where: { status: 'PENDING' } }) },
      { key: 'dealerApplications', audience: 'ADMIN', count: () => p.dealerApplication.count({ where: { status: 'PENDING' } }) },
      { key: 'dealerClaims', audience: 'ADMIN', count: () => p.dealerRewardClaim.count({ where: { status: 'PENDING' } }) },
      { key: 'payouts', audience: 'ADMIN', count: () => p.payout.count({ where: { status: 'REQUESTED' } }) },
      // Cộng đồng: bài khách vừa đăng và câu hỏi chờ lâu là việc của người kiểm duyệt (cùng danh sách @AllowStaff ở CommunityFeedController).
      { key: 'communityPending', audience: COMMUNITY_MODERATORS, count: () => p.feedPost.count({ where: { status: 'PENDING' } }) },
      {
        key: 'communityUnanswered',
        audience: COMMUNITY_MODERATORS,
        count: async () => {
          const hours = await this.config?.get<unknown>(UNANSWERED_ALERT_HOURS_KEY, DEFAULT_UNANSWERED_ALERT_HOURS);
          return countUnansweredQuestions(p, unansweredCutoff(hours, now));
        },
      },
      // Cùng điều kiện với bộ lọc "VAT chờ xuất" ở tab Đơn hàng; xuất hoá đơn (issue-invoice) chỉ ADMIN nên chỉ ADMIN thấy số này.
      { key: 'invoicePending', audience: 'ADMIN', count: () => p.order.count({ where: buildAdminOrderWhere({ invoice: 'pending' }) }) },
      // Đổi rác: mỗi khoá đếm đúng một hàng đợi bằng cùng `where` với bộ lọc ở màn nhân viên/admin. Cảnh báo bất thường không vào hộp việc.
      { key: 'wasteToCount', audience: 'STAFF', count: () => p.wasteRequest.count({ where: WASTE_TO_COUNT_WHERE }) },
      { key: 'wasteUnmatched', audience: 'STAFF', count: () => p.wasteUnmatchedParcel.count({ where: WASTE_UNMATCHED_OPEN_WHERE }) },
      { key: 'wasteBlockedPending', audience: 'ADMIN', count: () => p.wasteRequest.count({ where: wasteCustomerBlockedWhere() }) },
      { key: 'wastePointsPending', audience: 'ADMIN', count: () => p.wastePoint.count({ where: WASTE_POINTS_PENDING_WHERE }) },
      { key: 'wastePerksPending', audience: 'ADMIN', count: () => p.wastePoint.count({ where: WASTE_PERKS_PENDING_WHERE }) },
      { key: 'wasteTransitOverdue', audience: 'ADMIN', count: async () => p.wasteRequest.count({ where: wasteTransitOverdueWhere(now, await this.transitReviewDays()) }) },
      { key: 'wasteGiftOverdue', audience: 'ADMIN', count: () => p.wasteGiftRedemption.count({ where: wasteGiftOverdueWhere(now) }) },
      { key: 'wasteOrderMismatch', audience: 'ADMIN', count: () => p.wasteRequest.count({ where: wasteOrderMismatchWhere() }) },
    ];
  }

  // SystemConfigService thay vì WasteConfigService: OpsModule không nhập WasteCoreModule, chỉ để đọc một con số.
  private async transitReviewDays(): Promise<number> {
    return (await this.config?.get<number>('waste.in_transit_review_days', 30)) ?? 30;
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
