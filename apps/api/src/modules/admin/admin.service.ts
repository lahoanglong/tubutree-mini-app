import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { VARIATION_ORDER_BY } from '../catalog/variation-order';
import { SystemConfigService } from '../system-config/system-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginated, skipTake } from '../../common/pagination';
import { escapePrismaLike, foldVietnamese } from '../catalog/search-text';
import { OrderReversalService } from '../orders/order-reversal.service';
import { OrderStatusService, toHttpBadRequest } from '../orders/order-status.service';
import { allowedNextStatuses } from '../orders/order-transition';
import { actorAllowedTransitions, actorTransitionBlock, type OrderActor } from './order-actor-transitions';
import { ADMIN_LATE_PAYMENT_REF, recordLatePaymentRefund } from '../orders/refund-queue';
import { formatVnd } from '../orders/refund-destination';
import { RbacService } from '../staff/rbac/rbac.service';
import { GomdonOrderService } from '../integrations/gomdon/gomdon-order.service';
import { GomdonClient } from '../integrations/gomdon/gomdon.client';
import { GOMDON_RECYCLING_TOGGLE_KEY } from '../integrations/gomdon/gomdon-config';
import {
  ADMIN_SEARCH_MIN_TRGM_LENGTH,
  ADMIN_SEARCH_USER_CAP,
  buildAdminOrderWhere,
  normalizeAdminOrderSearch,
  recipientPhoneVariants,
  searchPhone,
  type AdminOrderFilter,
  type InvoiceFilter,
  type PancakeFilter,
  type RecyclingFilter,
} from './admin-order-filter';
import { orderCsvChunks, userCsvChunks } from './admin-export';
import { redactConfigRows, redactValueForKey, restoreRedactedSecrets } from './config-redaction';
import { isDeadConfigKey } from '../system-config/dead-config-keys';
import { configPartnerKey, hasAdminConfigRule, validateAdminConfigValue } from './admin-config-rules';
import { normalizeCouponCode } from '../coupons/coupons.service';
import { recordUserAdminEvent } from '../../common/user-admin-events';
import { LAST_ADMIN_MESSAGE, assertAnotherActiveAdmin, lockAdminRoster } from '../../common/admin-roster';
import { STAFF_PERMISSIONS, isStaffPermission } from '../../common/staff-permissions';
import {
  CONSIGNMENT_PENDING_LINK_WHERE,
  PANCAKE_CODE_CHANGED,
  type MerchantReviewSeen,
  describePancakeLink,
  linkTubuFulfilledVariation,
  seenValue,
  unlinkTubuFulfilledVariation,
} from '../merchant/merchant-pancake-link';
import {
  MERCHANT_PRODUCT_ALREADY_REVIEWED,
  MERCHANT_PRODUCT_CONTENT_CHANGED,
  MERCHANT_PRODUCT_EDIT_STALE,
  PENDING_MERCHANT_PRODUCT_WHERE,
} from '../merchant/merchant-product-review';
import { maskPhone } from '../../common/mask-pii';

/** Mã % từ mức này trở lên bắt buộc có Giảm tối đa: 100% không trần là gõ nhầm hoặc mã lộ ra là mất cả đơn. */
const COUPON_PERCENT_NEEDS_CAP = 50;

function reviewConflict(code: string, message: string) {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code, message });
}

function staleEditReview() {
  return reviewConflict(
    MERCHANT_PRODUCT_EDIT_STALE,
    'Bản sửa này vừa được xử lý hoặc đối tác vừa sửa tiếp nên không còn là bản bạn đang xem.',
  );
}

function productContentChanged() {
  return reviewConflict(
    MERCHANT_PRODUCT_CONTENT_CHANGED,
    'Đối tác vừa sửa sản phẩm này (tên, mô tả, ảnh hoặc giá) sau lần bạn mở danh sách. Hãy xem lại nội dung mới rồi mới duyệt.',
  );
}

function productAlreadyReviewed(status: string | null | undefined) {
  const what =
    status === 'APPROVED'
      ? 'Sản phẩm này đã được admin khác duyệt xuất bản.'
      : status === 'REJECTED'
        ? 'Sản phẩm này đã được admin khác từ chối. Chỉ duyệt lại được khi đối tác sửa và gửi lại.'
        : 'Sản phẩm này vừa được xử lý ở nơi khác nên không còn ở hàng chờ duyệt.';
  return reviewConflict(MERCHANT_PRODUCT_ALREADY_REVIEWED, what);
}

/** `expectedUpdatedAt` admin gửi lên thành mốc thời gian; trống = không gửi, ngày giờ sai = 400. */
function seenVersionTime(value: string | null | undefined): number | undefined {
  const raw = seenValue(value);
  if (raw === undefined) return undefined;
  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) throw new BadRequestException('expectedUpdatedAt phải là ngày giờ hợp lệ (ISO 8601).');
  return time;
}

function pancakeCodeChanged(current: string | null) {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: PANCAKE_CODE_CHANGED,
    message: `Đối tác vừa đổi mã Pancake của sản phẩm này${current ? ` sang ${current}` : ''}, khác với mã bạn đang xem. Hãy xem lại sản phẩm sẽ bị chuyển rồi mới duyệt.`,
  });
}

/**
 * Nút "Đã nhận tiền" (confirmOrderPayment) có tác dụng: đơn lẻ chuyển khoản còn UNPAID và chưa huỷ/trả.
 * Đơn đại lý đi panel riêng (DealerPaymentPanel / confirmDealerOrderPayment).
 */
function canAdminConfirmRetailPayment(o: { type: string; paymentMethod: string; paymentStatus: string; status: string }) {
  return (
    o.type !== 'DEALER' &&
    o.paymentMethod === 'BANK_TRANSFER' &&
    o.paymentStatus === 'UNPAID' &&
    o.status !== 'CANCELLED' &&
    o.status !== 'RETURNED'
  );
}

/**
 * Nút "Ghi nhận tiền về muộn": đơn lẻ chuyển khoản đã huỷ/trả mà chưa từng ghi nhận tiền — admin đối soát sao kê thấy
 * khách chuyển sau khi huỷ thì ghi một khoản hoàn vào hàng đợi Hoàn tiền khách (D2).
 */
function canAdminRecordLatePayment(o: { type: string; paymentMethod: string; paymentStatus: string; status: string }) {
  return (
    o.type !== 'DEALER' &&
    o.paymentMethod === 'BANK_TRANSFER' &&
    o.paymentStatus === 'UNPAID' &&
    (o.status === 'CANCELLED' || o.status === 'RETURNED')
  );
}

/** Ô tìm người dùng: SĐT (cả +84/84), tên có hoặc không dấu, hoặc đúng id. `%`/`_` khớp đúng nghĩa đen. */
export function adminUserSearchWhere(search?: string): Prisma.UserWhereInput | undefined {
  const s = search?.trim();
  if (!s) return undefined;
  const like = escapePrismaLike(s);
  const phone = searchPhone(s);
  const folded = escapePrismaLike(foldVietnamese(s));
  return {
    OR: [
      { phone: { contains: like } },
      ...(phone && phone !== s ? [{ phone: { contains: phone } }] : []),
      { fullName: { contains: like, mode: 'insensitive' } },
      ...(folded ? [{ fullNameSearch: { contains: folded } }] : []),
      { id: s },
    ],
  };
}

/**
 * Khoản hoàn của đơn cho danh sách/chi tiết đơn admin (nhãn "Đang hoàn tiền", dòng khoản hoàn ở ngăn kéo). Không gồm
 * tài khoản ngân hàng: nhân viên CSKH/kho cũng xem danh sách này. DISMISSED không phải tiền Tubu nợ khách.
 */
const ORDER_LIST_REFUNDS = {
  where: { status: { not: 'DISMISSED' } },
  orderBy: { createdAt: 'asc' },
  select: { id: true, kind: true, method: true, status: true, amount: true, createdAt: true, completedAt: true },
} satisfies Prisma.Order$customerRefundsArgs;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly loyalty: LoyaltyService,
    private readonly affiliate: AffiliateService,
    private readonly notifications: NotificationsService,
    private readonly reversal: OrderReversalService,
    private readonly orderStatus: OrderStatusService,
    private readonly rbac: RbacService,
    private readonly gomdonOrder: GomdonOrderService,
    private readonly gomdonClient: GomdonClient,
  ) {}

  /**
   * Lịch sử đổi trạng thái của một đơn — ai đổi, từ đâu sang đâu, lúc nào.
   *
   * Có bảng mà không có đường đọc thì vẫn phải vào DB bằng SQL mỗi lần cần tra.
   */
  async orderStatusHistory(orderCode: string) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderCode }, { code: orderCode }] },
      select: { id: true, code: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    const rows = await this.prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true, phone: true },
        })
      : [];
    const actorMap = new Map(actors.map((a) => [a.id, a]));
    return {
      orderCode: order.code,
      history: rows.map((r) => ({ ...r, actor: r.actorId ? (actorMap.get(r.actorId) ?? null) : null })),
    };
  }

  // ── Dealer applications ──
  async listDealerApplications(status: string | undefined, page: number, limit: number, order?: 'asc' | 'desc') {
    const where = status ? { status: status as never } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dealerApplication.findMany({
        where,
        // Hàng chờ duyệt (PENDING) web gửi order=asc — hồ sơ cũ nhất lên đầu.
        orderBy: { createdAt: order ?? 'desc' },
        ...skipTake(page, limit),
      }),
      this.prisma.dealerApplication.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async reviewDealerApplication(
    adminId: string,
    id: string,
    approve: boolean,
    tierId?: string,
    reason?: string,
  ) {
    const app = await this.prisma.dealerApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Không tìm thấy đơn đăng ký.');
    if (app.status !== 'PENDING') throw new BadRequestException('Đơn đã được xử lý.');

    if (approve) {
      if (!tierId) throw new BadRequestException('Cần chọn bậc đại lý khi duyệt.');
      const tier = await this.prisma.dealerTier.findUnique({ where: { id: tierId } });
      if (!tier) throw new BadRequestException('Bậc đại lý không tồn tại.');
      // Merge vào metadata sẵn có — KHÔNG ghi đè (giữ segments/onboardedAt từ onboarding quiz).
      const user = await this.prisma.user.findUnique({
        where: { id: app.userId },
        select: { metadata: true },
      });
      const mergedMeta = {
        ...((user?.metadata as Record<string, unknown> | null) ?? {}),
        dealerTierId: tierId,
      };
      // Atomic guard status='PENDING' TRONG transaction — chống 2 admin duyệt cùng đơn
      // (check status ở ngoài chỉ để trả lỗi rõ ràng, không đủ chống race: cả 2 request có thể
      // đọc PENDING trước khi bên nào ghi xong). Không guard → user.update DEALER chạy 2 lần
      // (idempotent nhưng có thể ghi đè dealerTierId của admin thắng race sau).
      await this.prisma.$transaction(async (tx) => {
        // Duyệt đổi vai trò người nộp sang DEALER: người nộp là admin thì đây cũng là một lần hạ quyền admin.
        await lockAdminRoster(tx);
        const applicant = await tx.user.findUnique({ where: { id: app.userId }, select: { role: true } });
        if (applicant?.role === 'ADMIN') {
          if (app.userId === adminId) {
            throw new BadRequestException('Không thể tự duyệt hồ sơ đại lý của chính mình — nhờ một quản trị viên khác thực hiện.');
          }
          await assertAnotherActiveAdmin(tx, app.userId, LAST_ADMIN_MESSAGE.dealer);
        }
        const flipped = await tx.dealerApplication.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
        });
        if (flipped.count === 0) throw new BadRequestException('Đơn đã được xử lý.');
        await tx.user.update({
          where: { id: app.userId },
          data: { role: 'DEALER', metadata: mergedMeta },
        });
        // CTV đã mở gian hàng rồi lên đại lý/đối tác: nâng loại để đăng được sản phẩm riêng (giữ slug và bộ sưu tập).
        await tx.storefront.updateMany({ where: { ownerUserId: app.userId, type: 'CTV' }, data: { type: 'MERCHANT' } });
      });
    } else {
      const flipped = await this.prisma.dealerApplication.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'REJECTED', reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: reason },
      });
      if (flipped.count === 0) throw new BadRequestException('Đơn đã được xử lý.');
    }
    // SELLER-12: người đăng ký nhận kết quả (kèm lý do khi từ chối) thay vì phải tự mở lại trang để đoán.
    const tierName = approve && tierId
      ? (await this.prisma.dealerTier.findUnique({ where: { id: tierId }, select: { name: true } }))?.name ?? ''
      : '';
    await this.notifications
      .notify(app.userId, approve ? 'DEALER_APPLICATION_APPROVED' : 'DEALER_APPLICATION_REJECTED', {
        tier: tierName,
        reason: reason?.trim() || 'Hồ sơ chưa đủ điều kiện',
      })
      .catch((e: unknown) => this.logger.warn(`Báo kết quả hồ sơ đại lý ${id} lỗi: ${(e as Error).message}`));
    return this.prisma.dealerApplication.findUnique({ where: { id } });
  }

  // ── Users & orders ──
  async listUsers(page: number, limit: number, search?: string) {
    const where = adminUserSearchWhere(search);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        select: {
          id: true, zaloId: true, phone: true, fullName: true, role: true,
          pointsBalance: true, pointsConvertedBalance: true, walletBalance: true, tierId: true, createdAt: true,
          isBlocked: true, blockedAt: true, blockedReason: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  // ── Tra cứu cho ô chọn (thay nhập ID thô) + màn duyệt đánh giá / gói định kỳ (C-092) ──

  /**
   * Tìm sản phẩm kèm biến thể cho ô chọn của admin (Flash Sale cần Variation ID, Content Kit cần Product ID).
   * Khớp tên không dấu (cột nameSearch có index trigram), slug hoặc SKU; KHÔNG lọc isActive để admin thấy cả
   * hàng đang ẩn — cờ isActive đi kèm để ô chọn cảnh báo. Tối đa 20 sản phẩm.
   */
  async searchProducts(raw: string) {
    const q = raw.trim();
    if (q.length < 2) return [];
    const folded = escapePrismaLike(foldVietnamese(q));
    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { nameSearch: { contains: folded } },
          { slug: { contains: folded.replace(/ /g, '-') } },
          { variations: { some: { sku: { contains: escapePrismaLike(q), mode: 'insensitive' } } } },
        ],
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      take: 20,
      select: {
        id: true,
        name: true,
        slug: true,
        brand: true,
        thumbnail: true,
        isActive: true,
        variations: {
          orderBy: VARIATION_ORDER_BY,
          select: { id: true, name: true, sku: true, retailPrice: true, salePrice: true, stock: true, isActive: true },
        },
      },
    });
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      thumbnail: p.thumbnail,
      isActive: p.isActive,
      variations: p.variations.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        price: v.salePrice ?? v.retailPrice,
        stock: v.stock,
        isActive: v.isActive,
      })),
    }));
  }

  /** Nhãn "Sản phẩm · Biến thể (SKU)" cho các Variation ID đã lưu (vd danh sách mặt hàng của đợt Flash Sale). */
  async lookupVariations(idsCsv: string) {
    const ids = [...new Set(idsCsv.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 100);
    if (ids.length === 0) return [];
    const rows = await this.prisma.variation.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, sku: true, productId: true, product: { select: { name: true } } },
    });
    return rows.map((v) => ({ id: v.id, name: v.name, sku: v.sku, productId: v.productId, productName: v.product.name }));
  }

  /** Bậc đại lý để chọn khi duyệt/cấp vai trò DEALER (thay nhập Tier ID). */
  async listDealerTiers() {
    const tiers = await this.prisma.dealerTier.findMany({ orderBy: { minOrderVolume: 'asc' } });
    return tiers.map((t) => ({
      id: t.id,
      name: t.name,
      minOrderVolume: t.minOrderVolume,
      creditLimit: t.creditLimit,
      paymentTerms: t.paymentTerms,
    }));
  }

  /**
   * Danh sách đánh giá cho admin duyệt (kể cả đã ẩn). Ẩn/hiện dùng POST /reviews/:id/visibility sẵn có — nó tính
   * lại điểm sao của sản phẩm, nên không viết lại ở đây.
   */
  async listReviews(page: number, limit: number, visibility?: 'visible' | 'hidden', rating?: number) {
    const where: Prisma.ReviewWhereInput = {
      ...(visibility ? { isVisible: visibility === 'visible' } : {}),
      ...(rating ? { rating } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        select: {
          id: true,
          rating: true,
          comment: true,
          images: true,
          videoUrl: true,
          isVisible: true,
          isVerified: true,
          createdAt: true,
          user: { select: { id: true, fullName: true, phone: true } },
          product: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  /** Gói mua định kỳ để CSKH tra (chỉ xem; khách tự tạm dừng/huỷ trong app). Không trả addressId. */
  async listSubscriptions(page: number, limit: number, status?: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    const where: Prisma.SubscriptionWhereInput = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        select: {
          id: true,
          status: true,
          quantity: true,
          intervalWeeks: true,
          nextRunAt: true,
          lastOrderId: true,
          createdAt: true,
          user: { select: { id: true, fullName: true, phone: true } },
          variation: { select: { id: true, name: true, sku: true, product: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  /**
   * Cấp/đổi role cho user theo SĐT — THAY cho script SSH grant-admin.js (không audit, đi ngoài
   * hạ tầng quyền). Gọi qua endpoint @Roles('ADMIN') nên chỉ admin đăng nhập mới chạy được;
   * ghi log ai đổi (adminId) + role cũ→mới. KHÔNG tự tạo user (khác script test): SĐT chưa mở app
   * → NotFound để admin biết đối tác cần đăng nhập Zalo Mini App ít nhất 1 lần trước. SĐT dán từ Zalo (+84…, 84…,
   * có khoảng trắng/chấm) về dạng User.phone đang lưu (0xxxxxxxxx) bằng cùng hàm ô tìm người dùng dùng.
   */
  async setUserRole(
    adminId: string,
    phone: string,
    role: 'CUSTOMER' | 'AFFILIATE' | 'DEALER' | 'STAFF' | 'ADMIN',
    tierId?: string,
  ) {
    const normalized = searchPhone(phone) ?? phone.trim();
    const dealerTierId = role === 'DEALER' ? tierId?.trim() : undefined;
    // DEALER không bậc → dealerContext trả tier null và đơn CREDIT bỏ qua hạn mức công nợ (C-008); cùng
    // luật với duyệt hồ sơ đại lý: bắt buộc chọn bậc tồn tại, merge vào metadata sẵn có (giữ segments/onboardedAt).
    if (role === 'DEALER') {
      if (!dealerTierId) throw new BadRequestException('Cần chọn bậc đại lý khi cấp vai trò DEALER.');
      const tier = await this.prisma.dealerTier.findUnique({ where: { id: dealerTierId } });
      if (!tier) throw new BadRequestException('Bậc đại lý không tồn tại.');
    }
    const { updated, previousRole } = await this.prisma.$transaction(async (tx) => {
      await lockAdminRoster(tx);
      const user = await tx.user.findUnique({ where: { phone: normalized } });
      if (!user) throw new NotFoundException(`Không tìm thấy người dùng có SĐT ${normalized} (cần mở Mini App Zalo ≥1 lần).`);
      const previousRole = user.role;
      // Hai cách khoá cả tổ chức ra ngoài, trước đây đều không có gì chặn — và khôi phục thì chỉ
      // còn đường vào thẳng DB bằng SQL. Nút "Thu hồi" trong app nằm ngay trên dòng của chính
      // admin đang đăng nhập, chỉ cần một cú chạm nhầm.
      if (user.id === adminId && role !== 'ADMIN') {
        throw new BadRequestException('Không thể tự hạ quyền của chính mình — nhờ một quản trị viên khác thực hiện.');
      }
      if (previousRole === 'ADMIN' && role !== 'ADMIN') {
        await assertAnotherActiveAdmin(tx, user.id, LAST_ADMIN_MESSAGE.demote);
      }
      // Nhóm việc CSKH/KHO chỉ có nghĩa với STAFF: rời STAFF thì gỡ, lên lại STAFF phải gán lại có chủ đích.
      const droppedPerms = role !== 'STAFF' ? (user.staffPermissions ?? []) : [];
      const data: Prisma.UserUpdateInput = {
        role,
        ...(droppedPerms.length ? { staffPermissions: [] } : {}),
        ...(dealerTierId
          ? {
              metadata: {
                ...((user.metadata as Record<string, unknown> | null) ?? {}),
                dealerTierId,
              } as Prisma.InputJsonObject,
            }
          : {}),
      };
      const updated = await tx.user.update({
        where: { id: user.id },
        data,
        select: { id: true, phone: true, fullName: true, role: true },
      });
      if (previousRole !== role) {
        await recordUserAdminEvent(tx, { userId: user.id, kind: 'ROLE', from: previousRole, to: role, actorId: adminId });
      }
      if (droppedPerms.length) {
        await recordUserAdminEvent(tx, {
          userId: user.id,
          kind: 'STAFF_PERMISSIONS',
          from: droppedPerms.join(','),
          to: '',
          actorId: adminId,
        });
      }
      return { updated, previousRole };
    });
    // Thu hồi mọi RoleGrant (STAFF/ADMIN) xếp hạng CAO HƠN role vừa gán — trước đây KHÔNG làm
    // việc này: hạ quyền qua đường setUserRole trong khi grant từ /admin/staff/grant còn hiệu
    // lực → lần refresh token tiếp theo, applyGrants (chỉ nâng không hạ) tự phục hồi quyền cũ
    // (P0-3, docs/2026-09-08-review-progress.md). Chạy SAU khi user.update đã thành công —
    // nếu lỗi ở bước này, role đã hạ vẫn đứng, chỉ còn nguy cơ tự phục hồi ở lần refresh sau
    // (best-effort, không rollback role vì role change tự nó luôn đúng ý admin).
    const revoked = await this.rbac.revokeGrantsAbove(normalized, role).catch((err) => {
      this.logger.error(`revokeGrantsAbove lỗi cho SĐT ${maskPhone(normalized)}: ${err instanceof Error ? err.message : err}`);
      return 0;
    });
    if (revoked > 0) {
      this.logger.warn(`Admin ${adminId} đổi role user ${updated.id} (${maskPhone(normalized)}) → thu hồi ${revoked} grant xếp hạng cao hơn ${role}.`);
    }
    this.logger.warn(
      `Admin ${adminId} đổi role user ${updated.id} (${maskPhone(normalized)}): ${previousRole} → ${role}` +
        (dealerTierId ? ` (bậc ${dealerTierId})` : ''),
    );
    return { ok: true, ...updated, previousRole, ...(dealerTierId ? { dealerTierId } : {}) };
  }

  /**
   * KPI tổng quan (ADMINOPS-14). "Doanh thu" là tiền ĐÃ THU: đơn đã thanh toán, hoặc COD đã giao (bưu tá thu hộ),
   * trừ đơn huỷ/trả/đã hoàn và phần đã hoàn của các lần trả một phần. Trước đây cộng mọi đơn CONFIRMED→DELIVERED nên
   * đơn COD chưa giao (có thể bị huỷ/boom) và đơn chưa lên kho cũng thành doanh thu. Giá trị đơn đặt (GMV) và COD chưa
   * thu tách ô riêng; đơn trả hàng có ô riêng.
   */
  /**
   * Gán nhóm việc cho nhân viên (ADMINOPS-10). Chỉ cho tài khoản STAFF: ADMIN đã có mọi quyền, khách thì phải cấp vai
   * trò nhân viên trước. Có hiệu lực ở request kế tiếp (JwtStrategy đọc DB, cache vài giây).
   */
  async setStaffPermissions(adminId: string, userId: string, raw: string[]) {
    const unknown = raw.filter((p) => !isStaffPermission(p));
    if (unknown.length) throw new BadRequestException(`Nhóm việc không hợp lệ: ${unknown.join(', ')}.`);
    const perms = STAFF_PERMISSIONS.filter((p) => raw.includes(p));
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, staffPermissions: true } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    if (user.role !== 'STAFF') {
      throw new BadRequestException('Chỉ gán nhóm việc cho tài khoản Nhân viên (STAFF) — cấp vai trò nhân viên trước.');
    }
    const before = [...user.staffPermissions].sort().join(',');
    const after = perms.join(',');
    if (before === after) return { id: userId, staffPermissions: perms, changed: false };
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { staffPermissions: perms } }),
      recordUserAdminEvent(this.prisma, { userId, kind: 'STAFF_PERMISSIONS', from: before, to: after, actorId: adminId }),
    ]);
    this.logger.warn(`Admin ${adminId} đổi nhóm việc nhân viên ${userId}: [${before}] → [${after}]`);
    return { id: userId, staffPermissions: perms, changed: true };
  }

  /**
   * Chi tiết một người dùng cho admin/CSKH (ADMINOPS-11): hồ sơ + số dư, đơn gần nhất, sổ ví, Điểm Xanh, lịch sử vai trò
   * (sổ user_admin_events + quyền cấp theo SĐT) và lịch sử khoá. Mỗi phần tối đa DETAIL_TAKE dòng mới nhất.
   */
  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        role: true,
        staffPermissions: true,
        referralCode: true,
        pointsBalance: true,
        pointsConvertedBalance: true,
        walletBalance: true,
        isBlocked: true,
        blockedAt: true,
        blockedReason: true,
        createdAt: true,
        tier: { select: { name: true } },
      },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng.');
    const take = AdminService.DETAIL_TAKE;
    const [orders, orderTotal, wallet, points, events, grants] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, code: true, status: true, paymentMethod: true, paymentStatus: true, total: true, createdAt: true, fulfiller: true },
      }),
      this.prisma.order.count({ where: { userId } }),
      this.prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, delta: true, balanceAfter: true, type: true, refType: true, refId: true, reason: true, createdAt: true },
      }),
      this.prisma.pointsTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, delta: true, reason: true, refType: true, refId: true, lot: true, expiresAt: true, createdAt: true },
      }),
      this.prisma.userAdminEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      user.phone
        ? this.prisma.roleGrant.findMany({
            where: { phone: user.phone },
            orderBy: { createdAt: 'desc' },
            select: { id: true, role: true, grantedBy: true, note: true, revokedAt: true, createdAt: true },
          })
        : Promise.resolve([]),
    ]);
    const actorIds = [...new Set([...events.map((e) => e.actorId), ...grants.map((g) => g.grantedBy)].filter(Boolean) as string[])];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, phone: true } })
      : [];
    const actorName = new Map(actors.map((a) => [a.id, a.fullName ?? a.phone ?? a.id]));
    const withActor = <T extends { actorId: string | null }>(e: T) => ({ ...e, actorName: e.actorId ? (actorName.get(e.actorId) ?? null) : null });
    return {
      user,
      orders: { items: orders, total: orderTotal },
      wallet,
      points,
      roleHistory: events.filter((e) => e.kind === 'ROLE' || e.kind === 'STAFF_PERMISSIONS').map(withActor),
      blockHistory: events.filter((e) => e.kind === 'BLOCK' || e.kind === 'UNBLOCK').map(withActor),
      grants: grants.map((g) => ({ ...g, grantedByName: actorName.get(g.grantedBy) ?? null })),
    };
  }

  static readonly DETAIL_TAKE = 30;

  async getDashboardStats() {
    const open: Prisma.OrderWhereInput = { status: { in: ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] } };
    // COD của đơn gian hàng tự giao do đối tác thu, không phải Tubu (đối soát trừ phí sàn từ phía đối tác).
    const collected: Prisma.OrderWhereInput = {
      status: { notIn: ['CANCELLED', 'RETURNED'] },
      paymentStatus: { not: 'REFUNDED' },
      OR: [{ paymentStatus: 'PAID' }, { status: 'DELIVERED', paymentMethod: 'COD', fulfiller: { not: 'MERCHANT' } }],
    };
    const [
      totalOrders,
      pendingOrders,
      shippingOrders,
      deliveredOrders,
      cancelledOrders,
      returnedOrders,
      pendingReturns,
      collectedResult,
      gmvResult,
      codPendingResult,
      refundRows,
      dealerDebtRows,
      totalUsers,
      totalAffiliates,
      totalProducts,
      plantedTreesCount,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } } }),
      this.prisma.order.count({ where: { status: { in: ['PACKED', 'SHIPPING'] } } }),
      this.prisma.order.count({ where: { status: 'DELIVERED' } }),
      this.prisma.order.count({ where: { status: 'CANCELLED' } }),
      this.prisma.order.count({ where: { status: 'RETURNED' } }),
      this.prisma.returnRequest.count({ where: { status: 'REQUESTED' } }),
      this.prisma.order.aggregate({ _sum: { total: true }, where: collected }),
      this.prisma.order.aggregate({ _sum: { total: true }, where: open }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: { paymentMethod: 'COD', paymentStatus: 'UNPAID', status: { in: ['CONFIRMED', 'PACKED', 'SHIPPING'] } },
      }),
      this.prisma.$queryRaw<{ all_refunds: bigint | null; on_collected: bigint | null }[]>`
        SELECT
          SUM(r."refundAmount" + r."shippingRefund") AS all_refunds,
          SUM(r."refundAmount" + r."shippingRefund") FILTER (
            WHERE o.status NOT IN ('CANCELLED', 'RETURNED')
              AND o."paymentStatus" <> 'REFUNDED'
              AND (o."paymentStatus" = 'PAID' OR (o.status = 'DELIVERED' AND o."paymentMethod" = 'COD' AND o.fulfiller <> 'MERCHANT'))
          ) AS on_collected
        FROM return_requests r
        JOIN orders o ON o.id = r."orderId"
        WHERE r.status = 'APPROVED'`,
      this.prisma.$queryRaw<{ outstanding: bigint | null }[]>`
        SELECT SUM(balance) AS outstanding
        FROM (SELECT SUM(delta) AS balance FROM dealer_credit_ledgers GROUP BY "userId") b
        WHERE balance > 0`,
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'AFFILIATE' } }),
      this.prisma.product.count(),
      this.prisma.plantedTree.count(),
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          code: true,
          total: true,
          status: true,
          paymentMethod: true,
          createdAt: true,
          user: { select: { fullName: true, phone: true } },
        },
      }),
    ]);
    const refunds = refundRows[0];
    const partialRefunds = Number(refunds?.on_collected ?? 0);

    return {
      totalRevenue: (collectedResult._sum.total ?? 0) - partialRefunds,
      gmv: gmvResult._sum.total ?? 0,
      codPendingValue: codPendingResult._sum.total ?? 0,
      totalOrders,
      pendingOrders,
      shippingOrders,
      deliveredOrders,
      cancelledOrders,
      returnedOrders,
      pendingReturns,
      returnRefundTotal: Number(refunds?.all_refunds ?? 0),
      dealerDebtOutstanding: Number(dealerDebtRows[0]?.outstanding ?? 0),
      totalUsers,
      totalAffiliates,
      totalProducts,
      plantedTreesCount,
      recentOrders,
    };
  }

  /** undefined = giữ lọc theo quan hệ `user` (chuỗi quá ngắn cho trigram, hoặc khớp quá nhiều khách). */
  private async findSearchUserIds(search?: string): Promise<string[] | undefined> {
    const s = normalizeAdminOrderSearch(search);
    if (!s || s.length < ADMIN_SEARCH_MIN_TRGM_LENGTH) return undefined;
    const like = escapePrismaLike(s);
    const phone = searchPhone(s);
    const folded = foldVietnamese(s);
    const rows = await this.prisma.user.findMany({
      where: {
        OR: [
          { phone: { contains: like } },
          ...(phone && phone !== s ? [{ phone: { contains: phone } }] : []),
          { fullName: { contains: like, mode: 'insensitive' } },
          ...(folded.length >= ADMIN_SEARCH_MIN_TRGM_LENGTH ? [{ fullNameSearch: { contains: escapePrismaLike(folded) } }] : []),
        ],
      },
      select: { id: true },
      take: ADMIN_SEARCH_USER_CAP + 1,
    });
    return rows.length > ADMIN_SEARCH_USER_CAP ? undefined : rows.map((r) => r.id);
  }

  /** Đơn có SĐT người nhận khớp đúng số (index orders_shippingAddress_phone_idx trên đúng biểu thức này). */
  private async findSearchOrderIds(search?: string): Promise<string[] | undefined> {
    const s = normalizeAdminOrderSearch(search);
    const phone = s ? searchPhone(s) : null;
    const variants = phone ? recipientPhoneVariants(phone) : [];
    if (variants.length === 0) return undefined;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders WHERE ("shippingAddress" ->> 'phone') = ANY(${variants}::text[]) LIMIT ${ADMIN_SEARCH_USER_CAP}`;
    return rows.map((r) => r.id);
  }

  /** File CSV mọi đơn khớp bộ lọc (admin-export.ts đọc theo lô). */
  async orderCsv(f: Omit<AdminOrderFilter, 'searchUserIds' | 'searchOrderIds'>): Promise<AsyncGenerator<string>> {
    return orderCsvChunks(this.prisma, await this.adminOrderWhere(f));
  }

  userCsv(search?: string): AsyncGenerator<string> {
    return userCsvChunks(this.prisma, adminUserSearchWhere(search));
  }

  /** Điều kiện lọc đơn admin dùng chung cho danh sách và file xuất CSV — cùng một tập đơn. */
  async adminOrderWhere(f: Omit<AdminOrderFilter, 'searchUserIds' | 'searchOrderIds'>): Promise<Prisma.OrderWhereInput> {
    const [searchUserIds, searchOrderIds] = await Promise.all([
      this.findSearchUserIds(f.search),
      this.findSearchOrderIds(f.search),
    ]);
    return buildAdminOrderWhere({ ...f, searchUserIds, searchOrderIds });
  }

  /**
   * Danh sách đơn cho admin. `include` (không `select`) nên trả ĐỦ cột vô hướng của Order — gồm
   * hasRecyclingPickup/recyclingNote/gomdonStatus/gomdonPartnerCode/gomdonCancelStatus/deliveredAt mà
   * web admin cần để hiện thu gom. `recycling='attention'` = hàng đợi "Cần xử lý thu gom"
   * (xem admin-order-filter.ts).
   */
  async listOrders(
    page: number,
    limit: number,
    status?: string,
    search?: string,
    recycling?: RecyclingFilter,
    invoice?: InvoiceFilter,
    pancake?: PancakeFilter,
    from?: string,
    to?: string,
    viewer: OrderActor = { role: 'ADMIN' },
  ) {
    const where = await this.adminOrderWhere({ status, search, recycling, invoice, pancake, from, to });
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        include: {
          items: true,
          user: { select: { id: true, phone: true, fullName: true } },
          fulfillerStorefront: { select: { title: true } },
          customerRefunds: ORDER_LIST_REFUNDS,
          gomdonAlerts: {
            where: { resolvedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { id: true, message: true, createdAt: true },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    // Đơn đại lý: gắn cờ "Ghi công nợ" (có dòng DealerCreditLedger refType=ORDER — đúng điều kiện
    // DealerService.confirmDealerOrderPayment dùng để từ chối). Đơn công nợ cũng BANK_TRANSFER + UNPAID
    // nên màn admin không tự phân biệt được với đơn trả trước đang chờ chuyển khoản; không có cờ này thì
    // nút "Xác nhận đã nhận chuyển khoản" hiện cả trên đơn công nợ rồi bấm vào mới bị từ chối.
    const dealerIds = items.filter((o) => o.type === 'DEALER').map((o) => o.id);
    const debits = dealerIds.length
      ? await this.prisma.dealerCreditLedger.findMany({
          where: { refType: 'ORDER', refId: { in: dealerIds } },
          select: { refId: true },
        })
      : [];
    const onCredit = new Set(debits.map((d) => d.refId));
    const lateCandidates = items.filter((o) => canAdminRecordLatePayment(o)).map((o) => o.id);
    const lateRecorded = new Set(
      lateCandidates.length
        ? (
            await this.prisma.orderCustomerRefund.findMany({
              where: { orderId: { in: lateCandidates }, kind: 'LATE_PAYMENT' },
              select: { orderId: true },
            })
          ).map((r) => r.orderId)
        : [],
    );
    // allowedTransitions/canConfirmPayment: web admin chỉ hiện nút API sẽ nhận (C-024) — cùng luật với
    // OrderStatusService.setStatus và confirmOrderPayment, không để UI tự đoán theo điều kiện cứng.
    const data = items.map((o) => {
      const dealerOnCredit = o.type === 'DEALER' ? onCredit.has(o.id) : undefined;
      return {
        ...o,
        ...(o.type === 'DEALER' ? { dealerOnCredit } : {}),
        allowedTransitions: actorAllowedTransitions(viewer, o, allowedNextStatuses({ ...o, onCredit: dealerOnCredit === true })),
        canConfirmPayment: canAdminConfirmRetailPayment(o),
        canRecordLatePayment: canAdminRecordLatePayment(o) && !lateRecorded.has(o.id),
      };
    });
    return paginated(data, page, limit, total);
  }

  /**
   * Đổi trạng thái đơn qua OrderStatusService — nguồn ghi status DUY NHẤT dùng chung với
   * merchant/pancake (order-status.service.ts). Trước đây hàm này tự ghi status không qua
   * bảng chuyển trạng thái nào → DELIVERED có thể bị admin lùi về CONFIRMED rồi user tự
   * "hủy" lại, hoàn ví/restock lần 2 trên đơn đã giao (P0-1, docs/2026-09-08-review-progress.md).
   * Cũng bỏ luôn việc tự ý force paymentStatus:'PAID' khi DELIVERED (P2-3) — OrderStatusService/
   * OrderReversalService chỉ đổi paymentStatus qua guard PAID→REFUNDED, không bao giờ ghi đè
   * REFUNDED trở lại PAID.
   */
  async updateOrderStatus(actor: OrderActor & { id: string }, id: string, status: OrderStatus, note?: string) {
    const adminId = actor.id;
    const before = await this.prisma.order.findFirst({ where: { OR: [{ id }, { code: id }] } });
    if (!before) throw new NotFoundException('Không tìm thấy đơn hàng.');
    const block = actorTransitionBlock(actor, before, status);
    if (block?.kind === 'FORBIDDEN') throw new ForbiddenException(block.message);
    if (block) throw new BadRequestException(block.message);

    let updated;
    try {
      updated = await this.orderStatus.setStatus(before.id, status, {
        note: note ? `Admin: ${note}` : undefined,
        customerReason: note,
        actorType: 'ADMIN',
        actorId: adminId,
      });
    } catch (err) {
      toHttpBadRequest(err);
    }

    this.logger.warn(`Admin ${adminId} cập nhật đơn ${before.code}: ${before.status} → ${status}`);
    return this.prisma.order.findUniqueOrThrow({
      where: { id: updated.id },
      include: { items: true, user: { select: { id: true, phone: true, fullName: true } } },
    });
  }

  /**
   * Nút "Đã nhận tiền" cho đơn chuyển khoản lẻ (khách tự đặt hoặc CTV lên đơn hộ). Hệ quả PAID đi qua
   * OrderStatusService.markPaid — cùng guard atomic và cùng hệ quả với đối soát thanh toán — nên bấm lặp
   * hay hai admin bấm cùng lúc chỉ lật một lần; ai bấm, lúc nào, mã giao dịch nằm ở order_status_history.
   * Đơn đại lý đi đường riêng (DealerService.confirmDealerOrderPayment) vì phải loại đơn ghi công nợ.
   */
  async confirmOrderPayment(adminId: string, idOrCode: string, dto: { bankRef?: string; note?: string; amount?: number } = {}) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
      select: { id: true, code: true, type: true, paymentMethod: true, total: true, status: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.type === 'DEALER') {
      throw new BadRequestException(
        `Đơn ${order.code} là đơn đại lý — xác nhận thanh toán ở mục đơn đại lý (có kiểm tra đơn ghi công nợ).`,
      );
    }
    if (order.paymentMethod !== 'BANK_TRANSFER') {
      throw new BadRequestException(`Đơn ${order.code} thanh toán ${order.paymentMethod}, không phải chuyển khoản.`);
    }

    // Số tiền thực nhận trên sao kê (R3-MONEY-3): khoản hoàn tiền về muộn là đúng số đó, không phải tổng đơn. Đơn còn sống
    // chỉ xác nhận được khi nhận đủ — chuyển thiếu thì chờ khách chuyển thêm hoặc huỷ đơn.
    const received = dto.amount ?? order.total;
    if (!Number.isInteger(received) || received <= 0 || received > order.total) {
      throw new BadRequestException(
        `Số tiền thực nhận phải từ 1đ đến tổng đơn ${formatVnd(order.total)}. Khách chuyển dư thì ghi đúng tổng đơn rồi hoàn tay phần dư.`,
      );
    }
    if (received < order.total && order.status !== 'CANCELLED' && order.status !== 'RETURNED') {
      throw new BadRequestException(
        `Khách mới chuyển ${formatVnd(received)}/${formatVnd(order.total)} — chưa xác nhận thanh toán được. Liên hệ khách chuyển thêm, hoặc huỷ đơn rồi ghi nhận tiền về muộn để hoàn số đã nhận.`,
      );
    }
    const bankRef = dto.bankRef?.trim();
    const adminNote = dto.note?.trim();
    const { outcome, order: current } = await this.orderStatus.markPaid(order.id, {
      actorType: 'ADMIN',
      actorId: adminId,
      note: ['Admin xác nhận', bankRef ? `Mã GD ${bankRef}` : null, adminNote || null].filter(Boolean).join(' · '),
    });
    if (outcome === 'CLOSED') {
      // D2: tiền về sau khi đơn đã huỷ/trả → không "hồi sinh" đơn, ghi khoản hoàn vào hàng đợi Hoàn tiền khách (cùng
      // đường webhook Pancake/ZaloPay); khách chọn Ví hay ngân hàng. Đơn đã có khoản tiền về muộn (webhook hay admin
      // khác ghi, mã GD gõ khác) thì không tạo khoản thứ hai.
      const created = await recordLatePaymentRefund(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        current,
        {
          amount: received,
          source: 'ADMIN',
          refKey: ADMIN_LATE_PAYMENT_REF,
          note: ['Admin ghi nhận tiền về muộn', bankRef ? `Mã GD ${bankRef}` : null, adminNote || null].filter(Boolean).join(' · '),
        },
      );
      this.logger.warn(`Admin ${adminId} ghi nhận tiền về muộn ${received}đ cho đơn đã đóng ${order.code}` + (bankRef ? ` (mã GD ${bankRef})` : ''));
      return {
        ok: true,
        alreadyPaid: false,
        latePayment: true,
        message: created
          ? `Đơn ${order.code} đã huỷ/trả — đã ghi khoản hoàn ${formatVnd(received)} tiền về muộn, xem mục Hoàn tiền khách (${
              current.placedForCustomer
                ? 'đơn CTV lên hộ: Tubu chuyển khoản tay cho khách cuối theo SĐT'
                : 'khách chọn nhận về Ví hay tài khoản ngân hàng'
            }).`
          : `Khoản tiền về muộn của đơn ${order.code} đã được ghi trước đó (tự động từ Pancake hoặc admin khác) — không tạo thêm khoản hoàn, xem mục Hoàn tiền khách.`,
        order: await this.prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          include: { items: true, user: { select: { id: true, phone: true, fullName: true } } },
        }),
      };
    }
    if (outcome === 'NOT_PAYABLE') {
      throw new BadRequestException(`Đơn ${order.code} đã hoàn tiền hoặc thanh toán lỗi — không thể xác nhận.`);
    }
    if (outcome === 'PAID') {
      this.logger.warn(
        `Admin ${adminId} xác nhận đã nhận chuyển khoản đơn ${order.code} (${order.total}đ)` + (bankRef ? `, mã GD ${bankRef}` : ''),
      );
    }
    const alreadyPaid = outcome === 'ALREADY_PAID';
    return {
      ok: true,
      alreadyPaid,
      latePayment: false,
      message: alreadyPaid
        ? `Đơn ${order.code} đã được ghi nhận thanh toán trước đó.`
        : `Đã xác nhận nhận tiền đơn ${order.code}.`,
      order: await this.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true, user: { select: { id: true, phone: true, fullName: true } } },
      }),
    };
  }

  // ── Hoá đơn VAT (thao tác admin) ──

  /**
   * "Đã xuất hoá đơn": admin phát hành hoá đơn ở hệ thống hoá đơn điện tử rồi ghi nhận ở đây (kèm link nếu có).
   * Hệ quả y hệt webhook Pancake `invoice.issued` (pancake.processor.ts onInvoiceIssued): invoiceStatus → ISSUED,
   * giữ invoiceUrl cũ nếu không có link mới, báo khách INVOICE_ISSUED. Dành cho đơn mà Pancake không tự xuất
   * (chưa cấu hình, webhook rớt). Guard atomic trên invoiceStatus nên hai admin bấm cùng lúc chỉ một người ghi và
   * báo khách; đơn đã huỷ/trả không xuất hoá đơn.
   */
  async issueOrderInvoice(adminId: string, idOrCode: string, dto: { invoiceUrl?: string } = {}) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
      select: { id: true, code: true, userId: true, status: true, invoiceRequest: true, invoiceStatus: true, invoiceUrl: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (!order.invoiceRequest) throw new BadRequestException(`Đơn ${order.code} chưa có yêu cầu xuất hóa đơn VAT.`);
    if (order.invoiceStatus === 'ISSUED') throw new BadRequestException(`Hóa đơn của đơn ${order.code} đã được phát hành.`);
    if (order.status === 'CANCELLED' || order.status === 'RETURNED') {
      throw new BadRequestException(`Đơn ${order.code} đã huỷ/trả — không xuất hóa đơn VAT.`);
    }
    const invoiceUrl = dto.invoiceUrl?.trim() || undefined;
    const res = await this.prisma.order.updateMany({
      where: { id: order.id, OR: [{ invoiceStatus: null }, { invoiceStatus: { not: 'ISSUED' } }] },
      data: { invoiceStatus: 'ISSUED', ...(invoiceUrl ? { invoiceUrl } : {}) },
    });
    if (res.count === 0) throw new BadRequestException(`Hóa đơn của đơn ${order.code} vừa được phát hành bởi người khác — vui lòng tải lại.`);
    this.logger.warn(`Admin ${adminId} ghi nhận đã xuất hóa đơn VAT đơn ${order.code}${invoiceUrl ? ` (${invoiceUrl})` : ''}.`);
    await this.notifications
      .notify(order.userId, 'INVOICE_ISSUED', { order_code: order.code })
      .catch((e) => this.logger.warn(`notify INVOICE_ISSUED lỗi (${order.userId}): ${(e as Error).message}`));
    return {
      ok: true,
      message: `Đã ghi nhận xuất hóa đơn VAT cho đơn ${order.code}.`,
      order: { id: order.id, code: order.code, invoiceStatus: 'ISSUED' as const, invoiceUrl: invoiceUrl ?? order.invoiceUrl },
    };
  }

  // ── Vận đơn thu gom Gomdon (thao tác admin) ──
  //
  // KHÔNG tự viết lại logic: GomdonOrderService.retryPush/cancelWaybill đã có claim nguyên tử + luật
  // "không tạo vận đơn thứ hai khi vận đơn cũ còn sống". Ở đây chỉ tìm đơn theo id HOẶC mã (như
  // updateOrderStatus), ghi vết ai bấm, và để nguyên lỗi của service (message tiếng Việt, đúng mã HTTP)
  // đi thẳng ra web — admin cần đọc đúng lý do bị từ chối.

  private async resolveOrderRef(idOrCode: string) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
      select: { id: true, code: true, gomdonStatus: true, gomdonPartnerCode: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    return order;
  }

  async retryGomdonPush(adminId: string, idOrCode: string, confirmedNoWaybill?: boolean) {
    const order = await this.resolveOrderRef(idOrCode);
    try {
      const res = await this.gomdonOrder.retryPush(order.id, { confirmedNoWaybill: confirmedNoWaybill === true });
      this.logger.warn(
        `Admin ${adminId} tạo lại vận đơn Gomdon đơn ${order.code} (trạng thái trước: ${order.gomdonStatus ?? 'null'}` +
          `${confirmedNoWaybill ? ', đã xác nhận KHÔNG có vận đơn trên Gomdon' : ''}).`,
      );
      return res;
    } catch (err) {
      this.logger.warn(
        `Admin ${adminId} tạo lại vận đơn Gomdon đơn ${order.code} bị từ chối: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }
  }

  async cancelGomdonWaybill(adminId: string, idOrCode: string) {
    const order = await this.resolveOrderRef(idOrCode);
    try {
      const res = await this.gomdonOrder.cancelWaybill(order.id);
      this.logger.warn(
        `Admin ${adminId} huỷ vận đơn Gomdon ${order.gomdonPartnerCode ?? '(chưa có mã)'} đơn ${order.code}: ${res.result}.`,
      );
      return res;
    } catch (err) {
      this.logger.warn(
        `Admin ${adminId} huỷ vận đơn Gomdon đơn ${order.code} bị từ chối: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }
  }

  /**
   * "Đã xử lý tay": admin đã xử lý vận đơn thu gom ngoài hệ thống → gomdonStatus MANUAL_HANDLED (guard
   * nguyên tử ở GomdonOrderService.markHandled), đơn rời hàng đợi "Cần xử lý thu gom". Ghi chú của admin
   * chỉ vào log vết (không ghi vào lịch sử vận chuyển khách nhìn thấy).
   */
  /**
   * "Đã xử lý" cho hàng đợi "Cần xử lý Pancake": người đã xem và xử lý xong việc Pancake báo (đang hoàn, hoàn một
   * phần, đơn bị xoá, trạng thái mâu thuẫn, hoàn tiền tay...) → đơn rời hàng đợi. Lý do cũ ghi vào log kèm admin.
   */
  async resolvePancakeAttention(adminId: string, idOrCode: string, note?: string) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
      select: { id: true, code: true, pancakeAttention: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    const r = await this.prisma.order.updateMany({
      where: { id: order.id, pancakeAttentionAt: { not: null } },
      data: { pancakeAttention: null, pancakeAttentionAt: null },
    });
    if (r.count === 0) throw new BadRequestException(`Đơn ${order.code} không còn trong hàng đợi cần xử lý Pancake.`);
    const cleanNote = note?.trim().replace(/\s+/g, ' ').slice(0, 500);
    this.logger.warn(
      `Admin ${adminId} đánh dấu đã xử lý việc Pancake của đơn ${order.code}: "${order.pancakeAttention ?? ''}"` +
        `${cleanNote ? ` — ghi chú: ${cleanNote}` : ''}.`,
    );
    return { ok: true, message: `Đơn ${order.code} đã rời hàng đợi cần xử lý Pancake.` };
  }

  async markGomdonHandled(adminId: string, idOrCode: string, note?: string) {
    const order = await this.resolveOrderRef(idOrCode);
    const cleanNote = note?.trim().replace(/\s+/g, ' ').slice(0, 500);
    try {
      const res = await this.gomdonOrder.markHandled(order.id, adminId);
      this.logger.warn(
        `Admin ${adminId} đánh dấu "Đã xử lý tay" vận đơn thu gom đơn ${order.code} (trạng thái trước: ${res.previousStatus})` +
          `${cleanNote ? ` — ghi chú: ${cleanNote}` : ''}.`,
      );
      return res;
    } catch (err) {
      this.logger.warn(
        `Admin ${adminId} đánh dấu "Đã xử lý tay" đơn ${order.code} bị từ chối: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }
  }

  /**
   * Tình trạng tích hợp Gomdon cho màn cấu hình — CHỈ boolean, không bao giờ trả tài khoản/mật khẩu.
   * Để admin thấy vì sao bật công tắc mà khách vẫn không thấy lựa chọn thu gom (thiếu env).
   */
  async gomdonStatus() {
    const [cfg, toggle, enabled, connection] = await Promise.all([
      this.gomdonClient.getConfig(),
      this.config.get<unknown>(GOMDON_RECYCLING_TOGGLE_KEY, false),
      this.gomdonOrder.isRecyclingEnabled(),
      this.gomdonClient.getHealth(),
    ]);
    return {
      baseUrlSet: Boolean(cfg.baseUrl),
      credentialsSet: Boolean(cfg.phone && cfg.password),
      configured: Boolean(cfg.baseUrl && cfg.phone && cfg.password),
      webhookSecretSet: Boolean(process.env.GOMDON_WEBHOOK_SECRET?.trim()),
      recyclingToggle: toggle === true,
      recyclingEnabled: enabled,
      // Lần gọi Gomdon gần nhất (chung mọi replica): đăng nhập bị từ chối thì checkout tự ẩn lựa chọn thu gom.
      connection,
    };
  }

  /** Nút "Kiểm tra kết nối": đăng nhập Gomdon thật (không tạo đơn nào). */
  async checkGomdonConnection(adminId: string) {
    const res = await this.gomdonClient.checkConnection();
    this.logger.warn(`Admin ${adminId} kiểm tra kết nối Gomdon: ${res.ok ? 'OK' : `lỗi — ${res.message}`}.`);
    return res;
  }

  /** Đánh dấu một báo động Gomdon đã xử lý — đơn rời hàng đợi "Cần xử lý thu gom" nếu không còn việc khác. */
  async resolveGomdonAlert(adminId: string, alertId: string) {
    const ok = await this.gomdonOrder.resolveAlert(alertId, adminId);
    if (!ok) throw new NotFoundException('Cảnh báo không tồn tại hoặc đã được xử lý.');
    this.logger.warn(`Admin ${adminId} đánh dấu đã xử lý cảnh báo Gomdon ${alertId}.`);
    return { ok: true as const };
  }

  // ── SystemConfig ──
  /**
   * Đọc config cho admin — MỌI khoá/field khớp /password|secret|token/i bị che (đệ quy trong JSON),
   * xem config-redaction.ts. Trước đây trả nguyên văn, kể cả mật khẩu Gomdon bản WIP lưu trong
   * shipping.gomdon.config.
   */
  async getConfig(category?: string) {
    if (category) return redactConfigRows(await this.config.getByCategory(category));
    const rows = redactConfigRows(await this.prisma.systemConfig.findMany({ orderBy: { category: 'asc' } }));
    // Khoá không còn code nào đọc (dead-config-keys.ts): UI hiện nhãn "Không dùng" thay vì để admin sửa vô ích.
    return rows.map((r) => ({ ...r, deprecated: isDeadConfigKey(r.key) }));
  }

  /**
   * Ghi config. GET đã che bí mật nên form JSON thô gửi lại chuỗi che khi admin bấm Lưu — khôi phục giá
   * trị thật ở đúng chỗ đó (restoreRedactedSecrets) thay vì ghi đè mật khẩu bằng "••••". Khoá có form
   * riêng (Gomdon, tích điểm) được kiểm luật trước khi ghi (admin-config-rules.ts).
   */
  async setConfig(adminId: string, key: string, value: object | string | number | boolean) {
    const existing = await this.prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
    // Không upsert khoá lạ: khoá gõ sai được tạo mới, không ai đọc, admin tưởng đã đổi cấu hình (ADMINOPS-3).
    if (!existing && !hasAdminConfigRule(key) && !SystemConfigService.hasWriteRule(key)) {
      throw new BadRequestException(`Không có khoá cấu hình "${key}". Kiểm tra lại tên khoá.`);
    }
    const restored = restoreRedactedSecrets(key, value, existing?.value) as object | string | number | boolean;
    const partnerKey = configPartnerKey(key);
    const partner = partnerKey ? await this.prisma.systemConfig.findUnique({ where: { key: partnerKey }, select: { value: true } }) : null;
    validateAdminConfigValue(key, restored, partner?.value);
    await this.config.set(key, restored, adminId);
    this.logger.warn(`Admin ${adminId} cập nhật cấu hình ${key}.`);
    return { ok: true, key, value: redactValueForKey(key, restored) };
  }

  // ── Coupons ──
  async createCoupon(data: {
    code: string;
    type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
    value: number;
    minOrder?: number;
    maxDiscount?: number;
    startAt: string;
    endAt: string;
    usageLimit?: number;
    perUserLimit?: number;
    scope: 'PUBLIC' | 'TIER' | 'USER_GROUP' | 'BIRTHDAY' | 'INVITE';
    // DTO (RequiredScopeMeta) đã bắt buộc đúng field khi scope=TIER/USER_GROUP trước khi tới đây.
    scopeMeta?: { tierId?: string; userId?: string };
  }) {
    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);
    if (endAt <= startAt) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
    if (endAt <= new Date()) throw new BadRequestException('Ngày kết thúc đã qua — mã tạo ra sẽ không dùng được.');
    if (data.type !== 'FREESHIP' && data.value <= 0) throw new BadRequestException('Mức giảm phải lớn hơn 0.');
    if (data.type === 'PERCENT' && data.value >= COUPON_PERCENT_NEEDS_CAP && !data.maxDiscount) {
      throw new BadRequestException(`Mã giảm từ ${COUPON_PERCENT_NEEDS_CAP}% phải đặt Giảm tối đa (đ) để một đơn lớn không được giảm gần hết.`);
    }
    if (data.type === 'AMOUNT' && data.minOrder && data.value >= data.minOrder) {
      throw new BadRequestException(
        `Mức giảm ${formatVnd(data.value)} phải nhỏ hơn đơn tối thiểu ${formatVnd(data.minOrder)} — không thì đơn ở mức tối thiểu được giảm hết tiền hàng. ` +
          'Kiểm tra lại số 0 của hai ô.',
      );
    }
    // isCouponEligible so đúng id: mã trỏ tới hạng / người dùng không có thật thì không ai dùng được.
    const tierId = data.scope === 'TIER' ? data.scopeMeta?.tierId : undefined;
    if (tierId && !(await this.prisma.membershipTier.findUnique({ where: { id: tierId }, select: { id: true } }))) {
      throw new BadRequestException(`Hạng thành viên "${tierId}" không tồn tại — mã tạo ra sẽ không ai dùng được.`);
    }
    const ownerId = data.scope === 'USER_GROUP' ? data.scopeMeta?.userId : undefined;
    if (ownerId && !(await this.prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } }))) {
      throw new BadRequestException(`Không tìm thấy người dùng "${ownerId}" — mã cá nhân tạo ra sẽ không ai dùng được.`);
    }
    const code = normalizeCouponCode(data.code);
    try {
      return await this.prisma.coupon.create({
        data: {
          code,
          type: data.type,
          value: data.value,
          minOrder: data.minOrder,
          maxDiscount: data.maxDiscount,
          startAt,
          endAt,
          usageLimit: data.usageLimit,
          perUserLimit: data.perUserLimit ?? 1,
          scope: data.scope,
          // Trước đây KHÔNG ghi scopeMeta → coupon scope TIER/USER_GROUP tạo ra fail-closed ở MỌI
          // user trong isCouponEligible (coupon-scope.ts) — KHÔNG AI DÙNG ĐƯỢC, không lỗi khi tạo.
          scopeMeta: data.scopeMeta ? (data.scopeMeta as object) : undefined,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Mã ${code} đã tồn tại.`);
      }
      throw err;
    }
  }

  /**
   * Danh sách mã cho tab Voucher (ADMINOPS-8). Mặc định ẩn voucher cá nhân sinh tự động (USER_GROUP:
   * chào mừng/sinh nhật/mua chung/vòng quay — hàng nghìn dòng) trừ khi lọc đúng scope đó.
   */
  async listCoupons(q: { page: number; limit: number; q?: string; scope?: string; status?: 'active' | 'inactive' | 'expired' }) {
    const now = new Date();
    const keyword = q.q ? normalizeCouponCode(q.q) : '';
    const where: Prisma.CouponWhereInput = {
      ...(keyword ? { code: { contains: escapePrismaLike(keyword) } } : {}),
      ...(q.scope ? { scope: q.scope as Prisma.CouponWhereInput['scope'] } : keyword ? {} : { scope: { not: 'USER_GROUP' } }),
      ...(q.status === 'active' ? { isActive: true, endAt: { gte: now } } : {}),
      ...(q.status === 'inactive' ? { isActive: false } : {}),
      ...(q.status === 'expired' ? { endAt: { lt: now } } : {}),
    };
    const { skip, take } = skipTake(q.page, q.limit);
    const [rows, total] = await Promise.all([
      this.prisma.coupon.findMany({ where, orderBy: { startAt: 'desc' }, skip, take }),
      this.prisma.coupon.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);
    const grouped = ids.length
      ? await this.prisma.couponRedemption.groupBy({ by: ['couponId'], where: { couponId: { in: ids } }, _count: { _all: true } })
      : [];
    const used = new Map(grouped.map((g) => [g.couponId, g._count._all]));
    return paginated(
      rows.map((r) => ({ ...r, redeemedCount: used.get(r.id) ?? 0 })),
      q.page,
      q.limit,
      total,
    );
  }

  /** Sửa nhanh mã đang chạy: tắt/bật, gia hạn/rút ngắn, đổi tổng lượt. Không sửa giá trị (tạo mã mới). */
  async updateCoupon(id: string, data: { isActive?: boolean; endAt?: string; usageLimit?: number | null }) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Không tìm thấy mã giảm giá.');
    const patch: Prisma.CouponUpdateInput = {};
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.endAt !== undefined) {
      const endAt = new Date(data.endAt);
      if (endAt <= coupon.startAt) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
      patch.endAt = endAt;
    }
    if (data.usageLimit !== undefined) {
      if (data.usageLimit !== null) {
        const redeemed = await this.prisma.couponRedemption.count({ where: { couponId: id } });
        if (data.usageLimit < redeemed) {
          throw new BadRequestException(`Mã đã được dùng ${redeemed} lượt, tổng lượt không được nhỏ hơn số này.`);
        }
      }
      patch.usageLimit = data.usageLimit;
    }
    const updated = await this.prisma.coupon.update({ where: { id }, data: patch });
    this.logger.warn(`Admin cập nhật mã giảm giá ${coupon.code}: ${JSON.stringify(data)}`);
    return updated;
  }

  // ── Import bảng giá đại lý theo bậc (§ back-office "admin Excel giá") ──
  /**
   * Nhập/đè giá đại lý cho 1 BẬC (tierId) từ danh sách {sku, price}.
   * Ghi vào Variation.dealerPrices[tierId] (MERGE, không mất bậc khác) + lưu DealerPriceHistory
   * (old→new, ai đổi) để truy vết. Bỏ qua dòng lỗi (sku rỗng/giá ≤ 0), gom SKU không tồn tại.
   */
  async importDealerPrices(adminId: string, tierId: string, rows: { sku: string; price: number }[]) {
    const tier = await this.prisma.dealerTier.findUnique({ where: { id: tierId } });
    if (!tier) throw new BadRequestException('Bậc đại lý không tồn tại.');

    // 1) Chuẩn hoá + validate TỪNG dòng trước (giữ nguyên logic cũ: sku rỗng/giá không hữu
    // hạn/giá <= 0 → bỏ) — bước này không đụng DB.
    const validRows: { sku: string; price: number }[] = [];
    for (const row of rows ?? []) {
      const sku = String(row?.sku ?? '').trim();
      const price = Math.round(Number(row?.price));
      if (!sku || !Number.isFinite(price) || price <= 0) continue; // bỏ dòng lỗi
      validRows.push({ sku, price });
    }

    // 2) Bug 1 (N+1 nghiêm trọng): trước đây findUnique() + 1 $transaction RIÊNG cho TỪNG dòng —
    // vài trăm/nghìn dòng = vài nghìn round-trip DB tuần tự → timeout/treo connection pool.
    // Nay MỘT findMany cho toàn bộ SKU, tra cứu qua Map, rồi ghi theo LÔ cố định bên dưới.
    const skus = [...new Set(validRows.map((r) => r.sku))];
    const variations = skus.length
      ? await this.prisma.variation.findMany({ where: { sku: { in: skus } } })
      : [];
    const variationBySku = new Map(variations.map((v) => [v.sku, v]));
    // dealerPrices hiện tại theo variationId — cập nhật DẦN trong vòng lặp bên dưới để 2 dòng
    // trùng SKU trong cùng file import (dòng sau đè dòng trước) thấy đúng giá của dòng liền
    // trước, không dùng snapshot cũ nạp 1 lần từ DB.
    const currentPrices = new Map<string, Record<string, number>>(
      variations.map((v) => [v.id, (v.dealerPrices as Record<string, number> | null) ?? {}]),
    );

    const notFound: string[] = [];
    const pending: { variationId: string; sku: string; oldPrice: number | null; newPrice: number }[] = [];
    for (const { sku, price } of validRows) {
      const v = variationBySku.get(sku);
      if (!v) {
        notFound.push(sku);
        continue;
      }
      const current = currentPrices.get(v.id) ?? {};
      const oldPrice = typeof current[tierId] === 'number' ? current[tierId] : null;
      if (oldPrice === price) continue; // không đổi → không ghi lịch sử thừa
      currentPrices.set(v.id, { ...current, [tierId]: price });
      pending.push({ variationId: v.id, sku, oldPrice, newPrice: price });
    }

    // 3) Ghi theo LÔ cố định — MỘT $transaction duy nhất cho cả BATCH_SIZE dòng (update + create
    // gộp chung), không phải 1 $transaction/dòng như trước.
    const BATCH_SIZE = 50;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      await this.prisma.$transaction([
        ...batch.map((w) =>
          this.prisma.variation.update({
            where: { id: w.variationId },
            data: { dealerPrices: currentPrices.get(w.variationId) },
          }),
        ),
        ...batch.map((w) =>
          this.prisma.dealerPriceHistory.create({
            data: {
              variationId: w.variationId,
              sku: w.sku,
              tierId,
              oldPrice: w.oldPrice,
              newPrice: w.newPrice,
              changedBy: adminId,
            },
          }),
        ),
      ]);
    }

    return {
      tierId,
      updated: pending.length,
      notFound,
      skipped: (rows?.length ?? 0) - pending.length - notFound.length,
    };
  }

  /** Lịch sử đổi giá đại lý (mới nhất trước), lọc theo biến thể hoặc SKU, kèm tên sản phẩm, bậc và người đổi. */
  async getDealerPriceHistory(filter: { variationId?: string; sku?: string }, page: number, limit: number) {
    const sku = filter.sku?.trim();
    const where: Prisma.DealerPriceHistoryWhereInput = {
      ...(filter.variationId ? { variationId: filter.variationId } : {}),
      ...(sku ? { sku: { contains: escapePrismaLike(sku), mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dealerPriceHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { variation: { select: { name: true, product: { select: { name: true } } } } },
        ...skipTake(page, limit),
      }),
      this.prisma.dealerPriceHistory.count({ where }),
    ]);
    const tierIds = [...new Set(items.map((h) => h.tierId))];
    const adminIds = [...new Set(items.map((h) => h.changedBy))];
    const [tiers, admins] = await Promise.all([
      tierIds.length ? this.prisma.dealerTier.findMany({ where: { id: { in: tierIds } }, select: { id: true, name: true } }) : [],
      adminIds.length ? this.prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, fullName: true } }) : [],
    ]);
    const tierName = new Map(tiers.map((t) => [t.id, t.name]));
    const adminName = new Map(admins.map((a) => [a.id, a.fullName]));
    const data = items.map(({ variation, ...h }) => ({
      ...h,
      productName: variation?.product.name ?? null,
      variationName: variation?.name ?? null,
      tierName: tierName.get(h.tierId) ?? null,
      changedByName: adminName.get(h.changedBy) ?? null,
    }));
    return paginated(data, page, limit, total);
  }

  // ── Kiểm duyệt sản phẩm của đối tác ──
  /**
   * Hàng chờ duyệt: sản phẩm mới/bị sửa khi chưa bán, và sản phẩm ĐANG BÁN có bản sửa nội dung chờ duyệt (R3-MERCHANT-4).
   * Dòng có bản sửa mang nội dung MỚI ở các trường thường (cái admin sẽ duyệt) và nội dung đang bán ở `live` để đối chiếu.
   */
  async listPendingMerchantProducts(page: number, limit: number) {
    const where = PENDING_MERCHANT_PRODUCT_WHERE;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          storefront: {
            select: { id: true, title: true, subdomain: true, ownerUserId: true },
          },
          variations: { orderBy: VARIATION_ORDER_BY },
          editDraft: true,
        },
        // Bản sửa mới của sản phẩm cũ phải nổi lên đầu như sản phẩm mới đăng.
        orderBy: { updatedAt: 'desc' },
        ...skipTake(page, limit),
      }),
      this.prisma.product.count({ where }),
    ]);
    // Màn duyệt phải thấy sản phẩm nào (thương hiệu, tồn, lượt bán) sẽ bị chuyển khi bấm Duyệt (R2-MERCHANT-1).
    const data = await Promise.all(
      items.map(async ({ editDraft, ...p }) => {
        const shown = editDraft
          ? { name: editDraft.name, description: editDraft.description, shortDesc: editDraft.shortDesc, images: editDraft.images, thumbnail: editDraft.thumbnail }
          : {};
        return {
          ...p,
          ...shown,
          isEdit: !!editDraft,
          editVersion: editDraft ? editDraft.updatedAt.toISOString() : null,
          live: editDraft ? { name: p.name, description: p.description, shortDesc: p.shortDesc, thumbnail: p.thumbnail } : null,
          pancakeLink: await describePancakeLink(this.prisma, p),
        };
      }),
    );
    return paginated(data, page, limit, total);
  }

  /**
   * Sản phẩm đối tác đang giữ biến thể Pancake ("Tubu giao hộ" đã duyệt) — nơi admin gỡ liên kết và xác nhận hàng ký gửi.
   * `consignment: 'PENDING'` chỉ lấy liên kết nhận lại còn chờ xác nhận, khớp số "Việc cần xử lý".
   */
  async listLinkedMerchantProducts(page: number, limit: number, consignment?: 'PENDING') {
    const where: Prisma.MerchantPancakeLinkWhereInput = consignment === 'PENDING' ? CONSIGNMENT_PENDING_LINK_WHERE : { unlinkedAt: null };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.merchantPancakeLink.findMany({
        where,
        orderBy: { linkedAt: 'desc' },
        ...skipTake(page, limit),
        select: {
          id: true,
          linkedAt: true,
          takeover: true,
          stockAtLink: true,
          consignmentConfirmedAt: true,
          originProductId: true,
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              thumbnail: true,
              isActive: true,
              approvalStatus: true,
              storefront: { select: { id: true, title: true, subdomain: true } },
            },
          },
          variation: { select: { pancakeId: true, name: true, stock: true } },
          originProduct: { select: { id: true, name: true, slug: true, brand: true, isActive: true } },
        },
      }),
      this.prisma.merchantPancakeLink.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  /**
   * "Gỡ liên kết": trả biến thể Pancake về sản phẩm gốc (bật lại nếu lần liên kết đã tắt nó), tắt bán sản phẩm đối tác và báo
   * đối tác. Đối tác mở bán lại thì sản phẩm về chờ duyệt.
   */
  async unlinkMerchantProduct(adminId: string, productId: string, reason: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, storefront: { select: { ownerUserId: true } } },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const why = reason.trim() || 'Tubu gỡ liên kết';
    const link = await this.prisma.$transaction((tx) =>
      unlinkTubuFulfilledVariation(tx, productId, { actorId: adminId, reason: why, deactivate: true, legacy: 'throw' }),
    );
    if (!link) throw new BadRequestException('Sản phẩm này không còn liên kết mã Pancake nào.');
    this.logger.warn(`Admin ${adminId} gỡ liên kết Pancake của sản phẩm đối tác ${productId}: ${why}`);
    const ownerId = product.storefront?.ownerUserId;
    if (ownerId) {
      await this.notifications
        .notify(ownerId, 'MERCHANT_PRODUCT_UNLINKED', { product_name: product.name, reason: why })
        .catch((e: unknown) => this.logger.warn(`Báo đối tác gỡ liên kết ${productId} lỗi: ${(e as Error).message}`));
    }
    return { ok: true, originProductId: link.originProductId };
  }

  /**
   * Duyệt/từ chối một dòng ở màn "Duyệt SP đối tác". Dòng "Bản sửa chờ duyệt" mang `editVersion` (lần sửa gần nhất admin đã xem)
   * và chỉ xử lý được đúng bản đó: bản đã bị admin khác xử lý, đối tác sửa tiếp hoặc sửa lại về nội dung đang bán đều trả 400 chứ
   * không bao giờ rơi sang duyệt cả sản phẩm — sản phẩm đang bán không thể bị từ chối/gỡ Pancake bởi một cú bấm trên dòng đã cũ.
   * Dòng sản phẩm chờ duyệt lần đầu (không có `editVersion`) chỉ đổi được sản phẩm còn PENDING_REVIEW.
   */
  async reviewMerchantProduct(
    adminId: string,
    productId: string,
    approve: boolean,
    rejectReason?: string,
    confirmTakeover = false,
    editVersion?: string,
    seen: MerchantReviewSeen = {},
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { storefront: { select: { ownerUserId: true } }, editDraft: true },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const reason = approve ? null : (rejectReason?.trim() || 'Không đạt tiêu chuẩn xanh của Tubu Tree');
    if (editVersion !== undefined) {
      const seenAt = new Date(editVersion).getTime();
      if (product.approvalStatus !== 'APPROVED' || !product.editDraft || product.editDraft.updatedAt.getTime() !== seenAt) {
        throw staleEditReview();
      }
      return this.reviewProductEdit(adminId, product, product.editDraft, approve, reason);
    }

    // Admin đã gửi mã thấy trên màn duyệt thì chỉ duyệt đúng mã đó: đối tác đổi mã sau khi admin mở danh sách có thể là mã của một
    // sản phẩm Tubu đang bán khác mà admin chưa hề xem. Không gửi (client khác màn duyệt) thì duyệt theo mã đang có, ghi cảnh báo.
    // Cùng quy ước cho phiên bản nội dung (`updatedAt` của dòng lúc tải danh sách): đối tác sửa tên, mô tả, ảnh, giá sau đó thì
    // nội dung lên sàn là nội dung admin chưa từng xem, nên gửi mà lệch là 409 (R5-PARTNER-1).
    const sentCode = seen.pancakeCode ?? undefined;
    const codeSent = sentCode !== undefined;
    const seenCode = sentCode?.trim() || null;
    const readCode = product.pancakeLinkCode ?? null;
    const seenVersion = seenVersionTime(seen.updatedAt);
    const seenTakeover = seenValue(seen.takeoverProductId);
    if (product.approvalStatus === 'PENDING_REVIEW') {
      if (codeSent && seenCode !== readCode) throw pancakeCodeChanged(readCode);
      if (seenVersion !== undefined && product.updatedAt.getTime() !== seenVersion) throw productContentChanged();
    }

    // CAS cố định theo PENDING_REVIEW (không theo trạng thái vừa đọc): hai admin cùng mở danh sách chờ duyệt, A bấm Duyệt còn
    // B bấm Từ chối hai giây sau thì trước đây B ghi đè kết quả của A mà A không hề biết. Nay người thứ hai nhận 409 rõ ràng
    // thay vì lặng lẽ lật ngược quyết định, kể cả khi sản phẩm đã APPROVED và đang bán.
    // "Tubu giao hộ" (D4): chuyển biến thể Pancake sang sản phẩm (hoặc trả về sản phẩm gốc khi từ chối) trong CÙNG
    // transaction — mã vừa bị sản phẩm khác lấy thì rollback cả lần duyệt.
    const linked = await this.prisma.$transaction(async (tx) => {
      // Cả mã Pancake đang xin liên kết và phiên bản nội dung: đối tác đổi mã hay sửa giữa lúc admin xem và bấm thì không duyệt
      // nhầm mã hay nội dung admin chưa xem.
      const moved = await tx.product.updateMany({
        where: {
          id: productId,
          approvalStatus: 'PENDING_REVIEW',
          pancakeLinkCode: product.pancakeLinkCode,
          ...(seenVersion !== undefined ? { updatedAt: new Date(seenVersion) } : {}),
        },
        data: { approvalStatus: approve ? 'APPROVED' : 'REJECTED', rejectReason: reason },
      });
      if (moved.count === 0) {
        const now = await tx.product.findUnique({
          where: { id: productId },
          select: { approvalStatus: true, pancakeLinkCode: true, updatedAt: true },
        });
        if (!now || now.approvalStatus !== 'PENDING_REVIEW') throw productAlreadyReviewed(now?.approvalStatus);
        if ((now.pancakeLinkCode ?? null) !== readCode) throw pancakeCodeChanged(now.pancakeLinkCode);
        if (seenVersion !== undefined && now.updatedAt?.getTime() !== seenVersion) throw productContentChanged();
        throw productAlreadyReviewed(now.approvalStatus);
      }
      if (approve) return linkTubuFulfilledVariation(tx, product, { adminId, confirmTakeover, takeoverProductId: seenTakeover });
      // Sản phẩm chờ duyệt đang giữ biến thể Pancake mà bị từ chối: trả biến thể về sản phẩm gốc để SKU vẫn bán được.
      await unlinkTubuFulfilledVariation(tx, productId, { actorId: adminId, reason: reason ?? '', deactivate: false });
      return undefined;
    });
    const updated = await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });

    if (approve && readCode) {
      const notSent = [
        codeSent ? null : 'mã Pancake đã xem',
        linked?.takeover && seenTakeover === undefined ? `sản phẩm đang bán bị chuyển (${linked.originProductId})` : null,
      ].filter((x): x is string => !!x);
      if (notSent.length > 0) {
        this.logger.warn(
          `Admin ${adminId} duyệt mã Pancake ${readCode} (liên kết ${linked?.linkId ?? 'không tạo mới'}, sản phẩm đối tác ${productId}) mà không gửi ${notSent.join(' và ')}.`,
        );
      }
    }
    if (approve && seenVersion === undefined) {
      this.logger.warn(
        `Admin ${adminId} duyệt sản phẩm đối tác ${productId} (${product.name}) mà request thiếu expectedUpdatedAt nên không biết admin đã xem nội dung nào.`,
      );
    }

    this.logger.warn(
      `Admin ${adminId} đã ${approve ? 'DUYỆT' : 'TỪ CHỐI'} sản phẩm đối tác ${productId} (${product.name})`,
    );
    const ownerId = product.storefront?.ownerUserId;
    if (ownerId) {
      await this.notifications
        .notify(ownerId, approve ? 'MERCHANT_PRODUCT_APPROVED' : 'MERCHANT_PRODUCT_REJECTED', {
          product_name: product.name,
          reason: reason ?? '',
        })
        .catch((e: unknown) => this.logger.warn(`Báo đối tác kết quả duyệt ${productId} lỗi: ${(e as Error).message}`));
    }

    return updated;
  }

  /**
   * Duyệt/từ chối bản sửa nội dung của sản phẩm ĐANG BÁN (R3-MERCHANT-4). Sản phẩm vẫn APPROVED và giữ liên kết Pancake suốt
   * thời gian chờ; duyệt thì nội dung mới ghi đè, từ chối thì nội dung đang bán giữ nguyên. Xoá bản chờ có điều kiện theo lần
   * sửa gần nhất admin đã xem: hai admin cùng bấm, hoặc đối tác sửa tiếp giữa lúc admin đọc và bấm, chỉ một bên thắng.
   */
  private async reviewProductEdit(
    adminId: string,
    product: { id: string; name: string; storefront: { ownerUserId: string | null } | null },
    draft: { id: string; name: string; description: string; shortDesc: string | null; images: string[]; thumbnail: string | null; updatedAt: Date },
    approve: boolean,
    reason: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const taken = await tx.productEditDraft.deleteMany({ where: { id: draft.id, updatedAt: draft.updatedAt } });
      if (taken.count === 0) throw staleEditReview();
      await tx.product.update({
        where: { id: product.id },
        data: approve
          ? {
              name: draft.name,
              description: draft.description,
              shortDesc: draft.shortDesc,
              images: draft.images,
              thumbnail: draft.thumbnail,
              rejectReason: null,
            }
          : { rejectReason: reason },
      });
    });
    const updated = await this.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    this.logger.warn(
      `Admin ${adminId} đã ${approve ? 'DUYỆT' : 'TỪ CHỐI'} bản sửa của sản phẩm đối tác ${product.id} (${product.name})`,
    );
    const ownerId = product.storefront?.ownerUserId;
    if (ownerId) {
      await this.notifications
        .notify(ownerId, approve ? 'MERCHANT_PRODUCT_EDIT_APPROVED' : 'MERCHANT_PRODUCT_EDIT_REJECTED', {
          product_name: approve ? draft.name : product.name,
          reason: reason ?? '',
        })
        .catch((e: unknown) => this.logger.warn(`Báo đối tác kết quả duyệt bản sửa ${product.id} lỗi: ${(e as Error).message}`));
    }
    return updated;
  }
}
