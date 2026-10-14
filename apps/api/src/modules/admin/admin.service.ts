import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginated, skipTake } from '../../common/pagination';
import { foldVietnamese } from '../catalog/search-text';
import { OrderReversalService } from '../orders/order-reversal.service';
import { OrderStatusService, toHttpBadRequest } from '../orders/order-status.service';
import { allowedNextStatuses } from '../orders/order-transition';
import { RbacService } from '../staff/rbac/rbac.service';
import { GomdonOrderService } from '../integrations/gomdon/gomdon-order.service';
import { GomdonClient } from '../integrations/gomdon/gomdon.client';
import { GOMDON_RECYCLING_TOGGLE_KEY } from '../integrations/gomdon/gomdon-config';
import {
  ADMIN_SEARCH_MIN_TRGM_LENGTH,
  ADMIN_SEARCH_USER_CAP,
  buildAdminOrderWhere,
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
import { STAFF_PERMISSIONS, isStaffPermission } from '../../common/staff-permissions';
import { linkTubuFulfilledVariation } from '../merchant/merchant-pancake-link';
import { maskPhone } from '../../common/mask-pii';

/** Mã % từ mức này trở lên bắt buộc có Giảm tối đa: 100% không trần là gõ nhầm hoặc mã lộ ra là mất cả đơn. */
const COUPON_PERCENT_NEEDS_CAP = 50;

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

/** Ô tìm người dùng: SĐT (cả +84/84), tên có hoặc không dấu, hoặc đúng id. */
export function adminUserSearchWhere(search?: string): Prisma.UserWhereInput | undefined {
  const s = search?.trim();
  if (!s) return undefined;
  const phone = searchPhone(s);
  const folded = foldVietnamese(s);
  return {
    OR: [
      { phone: { contains: s } },
      ...(phone && phone !== s ? [{ phone: { contains: phone } }] : []),
      { fullName: { contains: s, mode: 'insensitive' } },
      ...(folded ? [{ fullNameSearch: { contains: folded } }] : []),
      { id: s },
    ],
  };
}

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
        const flipped = await tx.dealerApplication.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
        });
        if (flipped.count === 0) throw new BadRequestException('Đơn đã được xử lý.');
        await tx.user.update({
          where: { id: app.userId },
          data: { role: 'DEALER', metadata: mergedMeta },
        });
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
    const folded = foldVietnamese(q);
    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { nameSearch: { contains: folded } },
          { slug: { contains: folded.replace(/ /g, '-') } },
          { variations: { some: { sku: { contains: q, mode: 'insensitive' } } } },
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
          orderBy: { retailPrice: 'asc' },
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
   * → NotFound để admin biết đối tác cần đăng nhập Zalo Mini App ít nhất 1 lần trước.
   */
  async setUserRole(
    adminId: string,
    phone: string,
    role: 'CUSTOMER' | 'AFFILIATE' | 'DEALER' | 'STAFF' | 'ADMIN',
    tierId?: string,
  ) {
    const normalized = phone.trim();
    const user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    if (!user) throw new NotFoundException('Không tìm thấy user với SĐT này (cần mở Mini App Zalo ≥1 lần).');
    const previousRole = user.role;
    // Hai cách khoá cả tổ chức ra ngoài, trước đây đều không có gì chặn — và khôi phục thì chỉ
    // còn đường vào thẳng DB bằng SQL. Nút "Thu hồi" trong app nằm ngay trên dòng của chính
    // admin đang đăng nhập, chỉ cần một cú chạm nhầm.
    if (user.id === adminId && role !== 'ADMIN') {
      throw new BadRequestException('Không thể tự hạ quyền của chính mình — nhờ một quản trị viên khác thực hiện.');
    }
    if (previousRole === 'ADMIN' && role !== 'ADMIN') {
      const admins = await this.prisma.user.count({ where: { role: 'ADMIN' } });
      if (admins <= 1) {
        throw new BadRequestException('Đây là quản trị viên cuối cùng — cấp quyền cho người khác trước khi hạ.');
      }
    }
    // DEALER không bậc → dealerContext trả tier null và đơn CREDIT bỏ qua hạn mức công nợ (C-008); cùng
    // luật với duyệt hồ sơ đại lý: bắt buộc chọn bậc tồn tại, merge vào metadata sẵn có (giữ segments/onboardedAt).
    // Nhóm việc CSKH/KHO chỉ có nghĩa với STAFF: rời STAFF thì gỡ, lên lại STAFF phải gán lại có chủ đích.
    const droppedPerms = role !== 'STAFF' ? (user.staffPermissions ?? []) : [];
    let data: Prisma.UserUpdateInput = { role, ...(droppedPerms.length ? { staffPermissions: [] } : {}) };
    let dealerTierId: string | undefined;
    if (role === 'DEALER') {
      dealerTierId = tierId?.trim();
      if (!dealerTierId) throw new BadRequestException('Cần chọn bậc đại lý khi cấp vai trò DEALER.');
      const tier = await this.prisma.dealerTier.findUnique({ where: { id: dealerTierId } });
      if (!tier) throw new BadRequestException('Bậc đại lý không tồn tại.');
      data = {
        ...data,
        metadata: {
          ...((user.metadata as Record<string, unknown> | null) ?? {}),
          dealerTierId,
        } as Prisma.InputJsonObject,
      };
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data,
        select: { id: true, phone: true, fullName: true, role: true },
      }),
      ...(previousRole !== role
        ? [recordUserAdminEvent(this.prisma, { userId: user.id, kind: 'ROLE', from: previousRole, to: role, actorId: adminId })]
        : []),
      ...(droppedPerms.length
        ? [
            recordUserAdminEvent(this.prisma, {
              userId: user.id,
              kind: 'STAFF_PERMISSIONS',
              from: droppedPerms.join(','),
              to: '',
              actorId: adminId,
            }),
          ]
        : []),
    ]);
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
      this.logger.warn(`Admin ${adminId} đổi role user ${user.id} (${maskPhone(normalized)}) → thu hồi ${revoked} grant xếp hạng cao hơn ${role}.`);
    }
    this.logger.warn(
      `Admin ${adminId} đổi role user ${user.id} (${maskPhone(normalized)}): ${previousRole} → ${role}` +
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
          SUM(r."refundAmount") AS all_refunds,
          SUM(r."refundAmount") FILTER (
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
    const s = search?.trim();
    if (!s || s.length < ADMIN_SEARCH_MIN_TRGM_LENGTH) return undefined;
    const phone = searchPhone(s);
    const folded = foldVietnamese(s);
    const rows = await this.prisma.user.findMany({
      where: {
        OR: [
          { phone: { contains: s } },
          ...(phone && phone !== s ? [{ phone: { contains: phone } }] : []),
          { fullName: { contains: s, mode: 'insensitive' } },
          ...(folded.length >= ADMIN_SEARCH_MIN_TRGM_LENGTH ? [{ fullNameSearch: { contains: folded } }] : []),
        ],
      },
      select: { id: true },
      take: ADMIN_SEARCH_USER_CAP + 1,
    });
    return rows.length > ADMIN_SEARCH_USER_CAP ? undefined : rows.map((r) => r.id);
  }

  /** Đơn có SĐT người nhận khớp đúng số (index orders_shippingAddress_phone_idx trên đúng biểu thức này). */
  private async findSearchOrderIds(search?: string): Promise<string[] | undefined> {
    const phone = search ? searchPhone(search) : null;
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
    // allowedTransitions/canConfirmPayment: web admin chỉ hiện nút API sẽ nhận (C-024) — cùng luật với
    // OrderStatusService.setStatus và confirmOrderPayment, không để UI tự đoán theo điều kiện cứng.
    const data = items.map((o) => {
      const dealerOnCredit = o.type === 'DEALER' ? onCredit.has(o.id) : undefined;
      return {
        ...o,
        ...(o.type === 'DEALER' ? { dealerOnCredit } : {}),
        allowedTransitions: allowedNextStatuses({ ...o, onCredit: dealerOnCredit === true }),
        canConfirmPayment: canAdminConfirmRetailPayment(o),
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
  async updateOrderStatus(adminId: string, id: string, status: OrderStatus, note?: string) {
    const before = await this.prisma.order.findFirst({ where: { OR: [{ id }, { code: id }] } });
    if (!before) throw new NotFoundException('Không tìm thấy đơn hàng.');

    let updated;
    try {
      updated = await this.orderStatus.setStatus(before.id, status, {
        note: note ? `Admin: ${note}` : undefined,
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
  async confirmOrderPayment(adminId: string, idOrCode: string, dto: { bankRef?: string; note?: string } = {}) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
      select: { id: true, code: true, type: true, paymentMethod: true, total: true },
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

    const bankRef = dto.bankRef?.trim();
    const adminNote = dto.note?.trim();
    const { outcome } = await this.orderStatus.markPaid(order.id, {
      actorType: 'ADMIN',
      actorId: adminId,
      note: ['Admin xác nhận', bankRef ? `Mã GD ${bankRef}` : null, adminNote || null].filter(Boolean).join(' · '),
    });
    if (outcome === 'CLOSED') {
      throw new BadRequestException(
        `Đơn ${order.code} đã huỷ/trả — nếu đã nhận tiền, cần hoàn tiền thủ công cho khách, không xác nhận thanh toán.`,
      );
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
    const [cfg, toggle, enabled] = await Promise.all([
      this.gomdonClient.getConfig(),
      this.config.get<unknown>(GOMDON_RECYCLING_TOGGLE_KEY, false),
      this.gomdonOrder.isRecyclingEnabled(),
    ]);
    return {
      baseUrlSet: Boolean(cfg.baseUrl),
      credentialsSet: Boolean(cfg.phone && cfg.password),
      configured: Boolean(cfg.baseUrl && cfg.phone && cfg.password),
      webhookSecretSet: Boolean(process.env.GOMDON_WEBHOOK_SECRET?.trim()),
      recyclingToggle: toggle === true,
      recyclingEnabled: enabled,
      // Lần gọi Gomdon gần nhất của process API: đăng nhập bị từ chối thì checkout tự ẩn lựa chọn thu gom.
      connection: this.gomdonClient.getHealth(),
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
      ...(keyword ? { code: { contains: keyword } } : {}),
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
      ...(sku ? { sku: { contains: sku, mode: 'insensitive' } } : {}),
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
  async listPendingMerchantProducts(page: number, limit: number) {
    const where = { approvalStatus: 'PENDING_REVIEW' as const };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          storefront: {
            select: { id: true, title: true, subdomain: true, ownerUserId: true },
          },
          variations: true,
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async reviewMerchantProduct(adminId: string, productId: string, approve: boolean, rejectReason?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { storefront: { select: { ownerUserId: true } } },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
    const reason = approve ? null : (rejectReason?.trim() || 'Không đạt tiêu chuẩn xanh của Tubu Tree');

    // CAS theo trạng thái đã đọc: hai admin cùng mở danh sách chờ duyệt, A bấm Duyệt còn B bấm
    // Từ chối hai giây sau thì trước đây B ghi đè kết quả của A mà A không hề biết. Nay người
    // thứ hai nhận lỗi rõ ràng thay vì lặng lẽ lật ngược quyết định.
    // "Tubu giao hộ" (D4): chuyển biến thể Pancake sang sản phẩm trong CÙNG transaction — mã vừa bị sản phẩm khác lấy thì
    // rollback cả lần duyệt.
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.product.updateMany({
        where: { id: productId, approvalStatus: product.approvalStatus },
        data: { approvalStatus: approve ? 'APPROVED' : 'REJECTED', rejectReason: reason },
      });
      if (moved.count === 0) {
        throw new BadRequestException('Sản phẩm vừa được người khác xử lý — tải lại danh sách để xem trạng thái mới.');
      }
      if (approve) await linkTubuFulfilledVariation(tx, product);
    });
    const updated = await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });

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
}
