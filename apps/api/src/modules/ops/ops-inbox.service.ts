import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { vnDateKey } from '../../common/vn-time';
import { mapLimit } from '../../common/map-limit';
import { COMMUNITY_MODERATORS, type StaffPermission } from '../../common/staff-permissions';
import { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';
import { UNCATEGORIZED_ON_SALE_WHERE } from '../catalog/public-product';
import { PENDING_MERCHANT_PRODUCT_WHERE } from '../merchant/merchant-product-review';
import { CONSIGNMENT_PENDING_LINK_WHERE } from '../merchant/merchant-pancake-link';
import {
  BANK_TRANSFER_TO_CONFIRM_WHERE,
  buildAdminOrderWhere,
  DEALER_TRANSFER_TO_CONFIRM_WHERE,
  PAYMENT_UNLINKED_CLOSED_WHERE,
  PAYMENT_UNLINKED_OPEN_WHERE,
  pancakeUnsyncedWhere,
  recyclingAttentionWhere,
} from '../admin/admin-order-filter';
import { OPEN_CUSTOMER_REFUND_STATUSES } from '../orders/refund-queue';
import { countUnansweredQuestions, DEFAULT_UNANSWERED_ALERT_HOURS, UNANSWERED_ALERT_HOURS_KEY, unansweredCutoff } from '../feed/community-unanswered';
import { readDealerPendingPaymentTtlHours, readPendingPaymentTtlHours } from '../orders/pending-payment-ttl';
import { isStorefrontApprovalRequired, STOREFRONT_PENDING_APPROVAL_WHERE } from '../storefront/storefront-config';
import { SystemConfigService } from '../system-config/system-config.service';
import { externalPointsAttentionParts } from '../external-points/external-points-attention';
import { bridgeIsDown, unforwardedWhere } from '../support-chat/support-chat-health';
import { CHAT_ENABLED_KEY } from '../support-chat/support-chat.config';
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
  | 'paymentUnlinked'
  | 'paymentUnlinkedClosed'
  | 'returnsPending'
  | 'returnsToReceive'
  | 'merchantOverdue'
  | 'merchantProducts'
  | 'consignmentPending'
  | 'merchantToSettle'
  | 'merchantPayoutsPending'
  | 'dealerApplications'
  | 'dealerClaims'
  | 'dealerClaimsToPay'
  | 'dealerCreditReported'
  | 'payouts'
  | 'payoutsToPay'
  | 'communityPending'
  | 'communityUnanswered'
  | 'invoicePending'
  | 'externalPoints'
  | 'supportChatUnforwarded'
  | 'zaloBridgeDown'
  | 'wasteToCount'
  | 'wasteUnmatched'
  | 'wasteBlockedPending'
  | 'wastePointsPending'
  | 'wastePerksPending'
  | 'wasteTransitOverdue'
  | 'wasteGiftOverdue'
  | 'wasteOrderMismatch'
  | 'bankTransferToConfirm'
  | 'dealerTransferToConfirm'
  | 'storefrontsPending'
  | 'accountDeletionPending'
  | 'shiftsPending'
  | 'communityReports'
  | 'productsMissingImage'
  | 'productsUncategorized';

/** Ai thấy việc này ngoài ADMIN: nhóm việc của nhân viên, hoặc 'STAFF' = mọi nhân viên (route vốn mở cho STAFF). */
type Audience = readonly StaffPermission[] | 'STAFF' | 'ADMIN';

export interface InboxViewer {
  role: string;
  staffPermissions?: string[];
}

/**
 * Trần số truy vấn đếm chạy cùng lúc cho một lượt tính hộp việc. Hơn 35 count song song từ vài tab admin cùng mở chiếm hết
 * pool (connection_limit=20) và các request khác dính P2028; 4 giữ tối đa 4 kết nối cho hộp việc, dư chỗ cho khách.
 */
export const INBOX_COUNT_CONCURRENCY = 4;
/** Số liệu hộp việc trễ tối đa chừng này sau thao tác; nhân viên bấm xử lý xong sẽ thấy số cũ tới hết hạn (đặt OPS_INBOX_CACHE_TTL_MS=0 để tắt). */
export const DEFAULT_INBOX_CACHE_TTL_MS = 20_000;
/** `countStoresToSettle` dựng bảng kê đối soát (~9 truy vấn) cho từng gian hàng có khoản chờ nên cache lâu hơn phần còn lại. */
export const DEFAULT_STORES_TO_SETTLE_TTL_MS = 60_000;

type InboxResult = { generatedAt: string; items: { key: InboxKey; count: number; hoursLeft?: number; oldestAt?: string; parts?: Record<string, number> }[] };
interface CacheEntry<T> {
  value: Promise<T>;
  /** Infinity khi lượt tính còn chạy: các lượt gọi tới sau dùng chung kết quả thay vì bắt đầu lượt mới. */
  expiresAt: number;
}

/** Ca chờ duyệt còn ý nghĩa: ngày làm việc từ hôm nay (giờ VN) trở đi. workDate là cột DATE lưu 00:00Z của ngày VN. */
const PENDING_SHIFT_WHERE = (now: Date) => ({ status: 'PENDING' as const, workDate: { gte: new Date(vnDateKey(now)) } });

interface InboxDef {
  key: InboxKey;
  audience: Audience;
  count: () => Promise<number>;
  /** Giờ còn lại trước khi hệ thống tự huỷ việc này; chỉ hỏi khi `count` > 0. */
  hoursLeft?: () => Promise<number | undefined>;
  /** Mốc của việc chờ lâu nhất (một findFirst sắp theo cột thời gian); chỉ hỏi khi `count` > 0. */
  oldest?: () => Promise<Date | null | undefined>;
  /** Các phần cộng nên số trên thẻ, để màn đích mở đúng phần có việc; chỉ hỏi khi `count` > 0 và dùng chung truy vấn với `count`. */
  parts?: () => Promise<Record<string, number>>;
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
    // Optional: chỉ để biết cầu nối Zalo đã cấu hình chưa (zaloBridgeDown); thiếu thì coi như chưa.
    @Optional() private readonly env?: ConfigService<Env, true>,
  ) {}

  // Khoá = tập hộp người xem được thấy (không phải tên vai trò): hai người cùng nhóm quyền dùng chung, khác nhóm thì tách, nên
  // staff không bao giờ nhận kết quả có hộp ngoài quyền. Số khoá tối đa là số tổ hợp nhóm quyền (nhỏ).
  private readonly cache = new Map<string, CacheEntry<InboxResult>>();
  private settleCache?: CacheEntry<number>;

  private ttlMs(key: 'OPS_INBOX_CACHE_TTL_MS' | 'OPS_STORES_TO_SETTLE_TTL_MS', fallback: number): number {
    // Không có ConfigService (khởi tạo trực tiếp trong test): không cache, để số đọc ngay sau thao tác luôn mới. Nest luôn truyền ConfigService nên PROD dùng mặc định.
    if (!this.env) return 0;
    const v: unknown = this.env.get(key, { infer: true });
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  }

  /** Giữ kết quả `ttl` ms sau khi xong; lượt lỗi không được nhớ. ttl 0 = không cache, không gộp lượt. */
  private memo<T>(slot: { get(): CacheEntry<T> | undefined; set(e: CacheEntry<T> | undefined): void }, ttl: number, compute: () => Promise<T>): Promise<T> {
    if (ttl <= 0) return compute();
    const hit = slot.get();
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const entry: CacheEntry<T> = { value: compute(), expiresAt: Infinity };
    slot.set(entry);
    entry.value.then(
      () => {
        entry.expiresAt = Date.now() + ttl;
      },
      () => {
        if (slot.get() === entry) slot.set(undefined);
      },
    );
    return entry.value;
  }

  private cachedStoresToSettle(now: Date): Promise<number> {
    return this.memo<number>(
      { get: () => this.settleCache, set: (e) => void (this.settleCache = e) },
      this.ttlMs('OPS_STORES_TO_SETTLE_TTL_MS', DEFAULT_STORES_TO_SETTLE_TTL_MS),
      () => this.merchant.countStoresToSettle(now),
    );
  }

  private defs(now: Date): InboxDef[] {
    const p = this.prisma;
    // Một lượt truy vấn cho cả số tổng lẫn các phần của thẻ điểm đơn sàn.
    let externalCache: ReturnType<typeof externalPointsAttentionParts> | undefined;
    const externalParts = () => (externalCache ??= externalPointsAttentionParts(p, now));
    return [
      { key: 'pancakeAttention', audience: ['KHO'], count: () => p.order.count({ where: { pancakeAttentionAt: { not: null } } }) },
      { key: 'pancakeUnsynced', audience: ['KHO'], count: () => p.order.count({ where: pancakeUnsyncedWhere(now) }) },
      { key: 'gomdonAttention', audience: ['KHO'], count: () => p.order.count({ where: recyclingAttentionWhere() }) },
      { key: 'customerRefunds', audience: ['KE_TOAN'], count: () => p.orderCustomerRefund.count({ where: { status: { in: [...OPEN_CUSTOMER_REFUND_STATUSES] } } }) },
      // Pancake báo đã thanh toán mà đơn chưa gắn đơn Pancake: hệ thống không tự PAID và không tự hoàn. Đơn còn mở: Kế toán đối chiếu sao kê rồi bấm
      // "Đã nhận tiền" (tự rời khi PAID). Đơn đã huỷ/trả: tiền khách có thể đã về, chỉ ADMIN ghi tiền về muộn/hoàn rồi bấm "Đã đối chiếu".
      // KHO không thấy: KHO không đóng được khoản này. "Cũ nhất" tính theo paymentUnlinkedFirstAt (paymentUnlinkedAt bị đẩy lên mỗi cặp mới).
      {
        key: 'paymentUnlinked',
        audience: ['KE_TOAN'],
        count: () => p.order.count({ where: PAYMENT_UNLINKED_OPEN_WHERE }),
        oldest: async () => (await p.order.findFirst({ where: PAYMENT_UNLINKED_OPEN_WHERE, orderBy: { paymentUnlinkedFirstAt: 'asc' }, select: { paymentUnlinkedFirstAt: true } }))?.paymentUnlinkedFirstAt,
      },
      {
        key: 'paymentUnlinkedClosed',
        audience: 'ADMIN',
        count: () => p.order.count({ where: PAYMENT_UNLINKED_CLOSED_WHERE }),
        oldest: async () => (await p.order.findFirst({ where: PAYMENT_UNLINKED_CLOSED_WHERE, orderBy: { paymentUnlinkedFirstAt: 'asc' }, select: { paymentUnlinkedFirstAt: true } }))?.paymentUnlinkedFirstAt,
      },
      {
        key: 'returnsPending',
        audience: ['CSKH'],
        count: () => p.returnRequest.count({ where: { status: 'REQUESTED' } }),
        oldest: async () => (await p.returnRequest.findFirst({ where: { status: 'REQUESTED' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt,
      },
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
      // Đơn chuyển khoản chờ kế toán bấm "Đã nhận tiền": quá hạn chờ thanh toán thì cron tự huỷ (pending-payment-expiry.cron), nên là việc gấp.
      {
        key: 'bankTransferToConfirm',
        audience: ['KE_TOAN'],
        count: () => p.order.count({ where: BANK_TRANSFER_TO_CONFIRM_WHERE }),
        hoursLeft: () => this.transferHoursLeft(BANK_TRANSFER_TO_CONFIRM_WHERE, readPendingPaymentTtlHours, now),
        oldest: async () => (await p.order.findFirst({ where: BANK_TRANSFER_TO_CONFIRM_WHERE, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt,
      },
      // Đơn đại lý "Trả trước" chờ kế toán xác nhận tiền: cùng cron tự huỷ nhưng TTL của đại lý (mặc định 72 giờ).
      {
        key: 'dealerTransferToConfirm',
        audience: ['KE_TOAN'],
        count: () => p.order.count({ where: DEALER_TRANSFER_TO_CONFIRM_WHERE }),
        hoursLeft: () => this.transferHoursLeft(DEALER_TRANSFER_TO_CONFIRM_WHERE, readDealerPendingPaymentTtlHours, now),
        oldest: async () => (await p.order.findFirst({ where: DEALER_TRANSFER_TO_CONFIRM_WHERE, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt,
      },
      // Cùng điều kiện với chip "Chờ duyệt" của tab Gian hàng (StorefrontAdminService.listWhere).
      {
        key: 'storefrontsPending',
        audience: 'ADMIN',
        count: async () => ((this.config ? await isStorefrontApprovalRequired(this.config) : true) ? p.storefront.count({ where: STOREFRONT_PENDING_APPROVAL_WHERE }) : 0),
        // Chờ duyệt tính từ lúc đăng; storefronts không có index trên publishedAt nhưng bảng nhỏ và lọc isPublished trước.
        oldest: async () => {
          const row = await p.storefront.findFirst({ where: STOREFRONT_PENDING_APPROVAL_WHERE, orderBy: { publishedAt: 'asc' }, select: { publishedAt: true, createdAt: true } });
          return row ? (row.publishedAt ?? row.createdAt) : null;
        },
      },
      // Khách được hứa xử lý trong 3 ngày làm việc (UsersService.requestDeletion); chỉ ADMIN xử lý được (AdminAccountDeletionController).
      {
        key: 'accountDeletionPending',
        audience: 'ADMIN',
        count: () => p.accountDeletionRequest.count({ where: { status: 'PENDING' } }),
        oldest: async () => (await p.accountDeletionRequest.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt,
      },
      // Ca nhân viên đăng ký chờ duyệt (ShiftApprovalTab): ca đã qua ngày làm việc thì không còn gì để duyệt. workDate là cột DATE lưu 00:00Z của ngày VN.
      {
        key: 'shiftsPending',
        audience: 'ADMIN',
        count: () => p.shift.count({ where: PENDING_SHIFT_WHERE(now) }),
        oldest: async () => (await p.shift.findFirst({ where: PENDING_SHIFT_WHERE(now), orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt,
      },
      { key: 'productsMissingImage', audience: 'ADMIN', count: () => p.product.count({ where: { isActive: true, images: { isEmpty: true } } }) },
      // Cùng điều kiện với bộ lọc "Chưa có danh mục" ở màn gán (onSale + uncategorized): số trên thẻ bằng số dòng ở màn đích.
      { key: 'productsUncategorized', audience: 'ADMIN', count: () => p.product.count({ where: UNCATEGORIZED_ON_SALE_WHERE }) },
      { key: 'merchantOverdue', audience: 'ADMIN', count: () => this.merchant.countOverdue(now) },
      { key: 'merchantProducts', audience: 'ADMIN', count: () => p.product.count({ where: PENDING_MERCHANT_PRODUCT_WHERE }) },
      { key: 'consignmentPending', audience: 'ADMIN', count: () => p.merchantPancakeLink.count({ where: CONSIGNMENT_PENDING_LINK_WHERE }) },
      { key: 'merchantToSettle', audience: ['KE_TOAN'], count: () => this.cachedStoresToSettle(now) },
      { key: 'merchantPayoutsPending', audience: ['KE_TOAN'], count: () => p.merchantPayout.count({ where: { status: 'PENDING' } }) },
      { key: 'dealerApplications', audience: 'ADMIN', count: () => p.dealerApplication.count({ where: { status: 'PENDING' } }) },
      { key: 'dealerClaims', audience: 'ADMIN', count: () => p.dealerRewardClaim.count({ where: { status: 'PENDING' } }) },
      // ADMIN đã duyệt, đang chờ kế toán chi và bấm "Đã chi" (DealerAdminController.markPaid mở cho KE_TOAN; duyệt vẫn chỉ ADMIN).
      { key: 'dealerClaimsToPay', audience: ['KE_TOAN'], count: () => p.dealerRewardClaim.count({ where: { status: 'APPROVED' } }) },
      // Đại lý báo đã chuyển khoản trả nợ, kế toán chưa ghi nhận hay đánh dấu không thấy tiền (tin báo admin không tới nhân viên kế toán).
      {
        key: 'dealerCreditReported',
        audience: ['KE_TOAN'],
        count: () => p.dealerCreditPaymentReport.count({ where: { status: 'REPORTED' } }),
        oldest: async () => (await p.dealerCreditPaymentReport.findFirst({ where: { status: 'REPORTED' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt,
      },
      { key: 'payouts', audience: 'ADMIN', count: () => p.payout.count({ where: { status: 'REQUESTED' } }) },
      // ADMIN đã duyệt, đang chờ kế toán chuyển tiền và bấm "Đã chi" (duyệt chỉ ADMIN, chi do kế toán nên hai khoá tách nhau).
      { key: 'payoutsToPay', audience: ['KE_TOAN'], count: () => p.payout.count({ where: { status: 'APPROVED' } }) },
      // Cộng đồng: bài khách vừa đăng và câu hỏi chờ lâu là việc của người kiểm duyệt (cùng danh sách @AllowStaff ở CommunityFeedController).
      { key: 'communityReports', audience: COMMUNITY_MODERATORS, count: () => p.communityReport.count({ where: { status: 'OPEN' } }) },
      { key: 'communityPending', audience: COMMUNITY_MODERATORS, count: () => p.feedPost.count({ where: { status: 'PENDING' } }) },
      {
        key: 'communityUnanswered',
        audience: COMMUNITY_MODERATORS,
        count: async () => {
          const hours = await this.config?.get<unknown>(UNANSWERED_ALERT_HOURS_KEY, DEFAULT_UNANSWERED_ALERT_HOURS);
          return countUnansweredQuestions(p, unansweredCutoff(hours, now));
        },
      },
      // Cùng điều kiện với bộ lọc "VAT chờ xuất" ở tab Đơn hàng; xuất hoá đơn (issue-invoice) là việc của kế toán.
      { key: 'invoicePending', audience: ['KE_TOAN'], count: () => p.order.count({ where: buildAdminOrderWhere({ invoice: 'pending' }) }) },
      // Điểm đơn ngoài app cần người: claim chờ duyệt, lần gửi mã quá 3 ngày chưa thấy đơn (hoặc thấy đơn nguồn lạ), đơn hoàn một phần sau khi đã cộng.
      {
        key: 'externalPoints',
        audience: ['CSKH'],
        count: async () => Object.values(await externalParts()).reduce((a, b) => a + b, 0),
        parts: () => externalParts(),
      },
      // Chat CSKH: hội thoại có tin chưa vào được nhóm Zalo (cùng điều kiện với bộ lọc "Chưa chuyển" ở tab Chat CSKH); cầu nối mất kết nối là việc của ADMIN (đăng nhập QR chỉ ADMIN).
      { key: 'supportChatUnforwarded', audience: ['CSKH'], count: () => p.supportConversation.count({ where: unforwardedWhere(now) }) },
      { key: 'zaloBridgeDown', audience: 'ADMIN', count: async () => ((await this.bridgeAlertable()) && bridgeIsDown(await p.supportBridgeStatus.findUnique({ where: { id: 'main' } }), now) ? 1 : 0) },
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

  /** Cùng luật với cảnh báo của cron cầu nối: chưa cấu hình cầu nối hoặc chat đang tắt thì không coi mất kết nối là việc cần xử lý. */
  private async bridgeAlertable(): Promise<boolean> {
    if (!this.env?.get('ZALO_BRIDGE_URL', { infer: true })) return false;
    return (await this.config?.get<boolean>(CHAT_ENABLED_KEY, false)) ?? false;
  }

  // SystemConfigService thay vì WasteConfigService: OpsModule không nhập WasteCoreModule, chỉ để đọc một con số.
  private async transitReviewDays(): Promise<number> {
    return (await this.config?.get<number>('waste.in_transit_review_days', 30)) ?? 30;
  }

  /** Số giờ còn lại của đơn chuyển khoản chờ lâu nhất trước khi cron tự huỷ (0 = đã quá hạn, chờ lượt cron kế). Đơn đã bàn giao vận chuyển không bao giờ bị cron huỷ nên không tính. */
  private async transferHoursLeft(
    where: typeof BANK_TRANSFER_TO_CONFIRM_WHERE | typeof DEALER_TRANSFER_TO_CONFIRM_WHERE,
    readTtl: (config: SystemConfigService) => Promise<number>,
    now: Date,
  ): Promise<number | undefined> {
    const oldest = await this.prisma.order.findFirst({ where: { ...where, autoCancelBlockedAt: null }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    if (!oldest || !this.config) return undefined;
    const ttl = await readTtl(this.config);
    return Math.max(0, Math.ceil((oldest.createdAt.getTime() + ttl * 3_600_000 - now.getTime()) / 3_600_000));
  }

  async counts(viewer: InboxViewer, now = new Date()): Promise<InboxResult> {
    const perms = viewer.staffPermissions ?? [];
    const visible = this.defs(now).filter(
      (d) =>
        viewer.role === 'ADMIN' ||
        (viewer.role === 'STAFF' && (d.audience === 'STAFF' || (Array.isArray(d.audience) && d.audience.some((a) => perms.includes(a))))),
    );
    const scope = visible.map((d) => d.key).join(',');
    return this.memo<InboxResult>(
      { get: () => this.cache.get(scope), set: (e) => void (e ? this.cache.set(scope, e) : this.cache.delete(scope)) },
      this.ttlMs('OPS_INBOX_CACHE_TTL_MS', DEFAULT_INBOX_CACHE_TTL_MS),
      () => this.compute(visible, now),
    );
  }

  private async compute(visible: InboxDef[], now: Date): Promise<InboxResult> {
    // Mỗi hộp là một việc: đếm xong mới hỏi các phần phụ (tuần tự trong hộp) để tổng số truy vấn song song không vượt trần.
    const rows = await mapLimit(visible, INBOX_COUNT_CONCURRENCY, async (d) => {
      const count = await d.count();
      if (count <= 0) return { d, count, hoursLeft: undefined, oldest: undefined, parts: undefined };
      const hoursLeft = await d.hoursLeft?.();
      const oldest = await d.oldest?.();
      const parts = await d.parts?.();
      return { d, count, hoursLeft, oldest, parts };
    });
    return {
      generatedAt: now.toISOString(),
      items: rows.map(({ d, count, hoursLeft, oldest, parts }) => ({
        key: d.key,
        count,
        ...(hoursLeft !== undefined ? { hoursLeft } : {}),
        ...(oldest ? { oldestAt: oldest.toISOString() } : {}),
        ...(parts ? { parts } : {}),
      })),
    };
  }
}
