import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginated, skipTake } from '../../common/pagination';
import { OrderReversalService } from '../orders/order-reversal.service';
import { OrderStatusService, toHttpBadRequest } from '../orders/order-status.service';
import { RbacService } from '../staff/rbac/rbac.service';

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
  ) {}

  // ── Đổi/trả (§6.4) ──
  /**
   * Kèm đơn + khách: portal web render `r.order?.code`, `r.user?.fullName`, tổng đơn và phương
   * thức thanh toán, nhưng trước đây truy vấn không include gì cả — admin chỉ thấy một dãy cuid
   * và chữ "Khách hàng", rồi bấm Duyệt để hoàn nguyên tổng đơn về ví mà KHÔNG nhìn thấy số tiền
   * mình đang hoàn.
   */
  async listReturnRequests(status: string | undefined, page: number, limit: number) {
    const where = status ? { status: status as never } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.returnRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
      }),
      this.prisma.returnRequest.count({ where }),
    ]);
    const decorated = (await this.withReturnContext(rows)) as unknown[];
    return paginated(decorated, page, limit, total);
  }

  /**
   * ReturnRequest chỉ lưu orderId/userId dạng chuỗi (không khai quan hệ trong schema) nên không
   * include được — nạp theo lô rồi ghép. Hai truy vấn cho cả trang, không phải N+1.
   */
  private async withReturnContext<T extends { orderId: string; userId: string } | null>(
    input: T | T[],
  ): Promise<unknown> {
    const rows = (Array.isArray(input) ? input : [input]).filter((r): r is NonNullable<T> => r != null);
    if (rows.length === 0) return Array.isArray(input) ? [] : null;
    const [orders, users] = await Promise.all([
      this.prisma.order.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.orderId))] } },
        select: { id: true, code: true, total: true, status: true, paymentMethod: true, paymentStatus: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, fullName: true, phone: true },
      }),
    ]);
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const userMap = new Map(users.map((u) => [u.id, u]));
    const decorated = rows.map((r) => ({
      ...r,
      order: orderMap.get(r.orderId) ?? null,
      user: userMap.get(r.userId) ?? null,
    }));
    return Array.isArray(input) ? decorated : decorated[0];
  }

  /** Duyệt đổi/trả. APPROVED → hoàn đúng kênh thanh toán + reverse điểm + reverse commission CTV + restock. */
  async reviewReturn(adminId: string, id: string, approve: boolean, note?: string) {
    const req = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Không tìm thấy yêu cầu đổi/trả.');
    // Atomic guard chuyển vào TRONG transaction (updateMany ở dưới) — chống 2 admin duyệt
    // cùng request gây hoàn ví 2 lần / restock 2 lần. Giữ NotFound check ở ngoài cho rõ message.

    if (!approve) {
      // REJECT idempotent: nếu request đã xử lý, updateMany count=0 → throw để admin biết.
      const rejected = await this.prisma.returnRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'REJECTED', adminNote: note, reviewedBy: adminId, reviewedAt: new Date() },
      });
      if (rejected.count === 0) throw new BadRequestException('Yêu cầu đã được xử lý.');
      return this.withReturnContext(await this.prisma.returnRequest.findUnique({ where: { id } }));
    }

    // Load order TRONG transaction để paymentStatus/status nhất quán với guard updateMany.
    // Snapshot ngoài tx sẽ stale nếu webhook Pancake/refund chạy chen giữa → từng gây
    // hoàn ví dựa trên paymentStatus cũ (PAID) trong khi DB đã REFUNDED → DOUBLE refund.
    const orderForReturn = await this.prisma.order.findUniqueOrThrow({
      where: { id: req.orderId },
      select: { id: true, userId: true, code: true },
    });
    await this.prisma.$transaction(async (tx) => {
      const approved = await tx.returnRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'APPROVED', adminNote: note, reviewedBy: adminId, reviewedAt: new Date() },
      });
      if (approved.count === 0) throw new BadRequestException('Yêu cầu đã được xử lý.');

      // Đọc order + items TRONG tx ngay TRƯỚC khi flip status — paymentStatus/status
      // ở đây mới là sự thật cho quyết định hoàn ví.
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderForReturn.id },
        include: { items: true },
      });
      // Guard status='DELIVERED' để KHÔNG đè CANCELLED/RETURNED (đơn đã hủy đã hoàn
      // ví ở orders.cancel — nếu đè thêm RETURNED rồi hoàn ví nữa = DOUBLE refund).
      // Khớp bảng chuyển trạng thái chung (order-transition.ts): DELIVERED→RETURNED
      // là transition hợp lệ DUY NHẤT ra khỏi DELIVERED.
      const flipped = await tx.order.updateMany({
        where: { id: order.id, status: 'DELIVERED' },
        data: { status: 'RETURNED' },
      });
      if (flipped.count === 0) {
        throw new BadRequestException('Đơn không ở trạng thái có thể trả (đã hủy/đã trả).');
      }
      // Duyệt đổi/trả cũng là một lần đổi trạng thái có hoàn tiền — phải có vết như mọi lối khác.
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: 'DELIVERED',
          toStatus: 'RETURNED',
          actorType: 'ADMIN',
          actorId: adminId,
          note: note ?? null,
        },
      });
      // Hoàn đúng KÊNH thanh toán + restock + release flash quota — logic dùng chung với
      // orders.service.cancel/OrderStatusService (xem order-reversal.service.ts), tránh
      // 3 bản chép tay lệch nhau (P0-4 trong docs/2026-09-08-review-progress.md).
      await this.reversal.reverseFinancials(tx, order);
    });
    // Reverse điểm Xanh + commission CTV + notify (idempotent — để ngoài tx an toàn).
    await this.loyalty.reverseOrderPoints(orderForReturn.id);
    await this.affiliate.reverseCommissionsForOrder(orderForReturn.id);
    await this.notifications
      .notify(orderForReturn.userId, 'RETURN_APPROVED', { order_code: orderForReturn.code })
      .catch(() => undefined);
    return this.withReturnContext(await this.prisma.returnRequest.findUnique({ where: { id } }));
  }

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
  async listDealerApplications(status: string | undefined, page: number, limit: number) {
    const where = status ? { status: status as never } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dealerApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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
    return this.prisma.dealerApplication.findUnique({ where: { id } });
  }

  // ── Users & orders ──
  async listUsers(page: number, limit: number) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        select: {
          id: true, zaloId: true, phone: true, fullName: true, role: true,
          pointsBalance: true, walletBalance: true, tierId: true, createdAt: true,
        },
      }),
      this.prisma.user.count(),
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
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { role },
      select: { id: true, phone: true, fullName: true, role: true },
    });
    // Thu hồi mọi RoleGrant (STAFF/ADMIN) xếp hạng CAO HƠN role vừa gán — trước đây KHÔNG làm
    // việc này: hạ quyền qua đường setUserRole trong khi grant từ /admin/staff/grant còn hiệu
    // lực → lần refresh token tiếp theo, applyGrants (chỉ nâng không hạ) tự phục hồi quyền cũ
    // (P0-3, docs/2026-09-08-review-progress.md). Chạy SAU khi user.update đã thành công —
    // nếu lỗi ở bước này, role đã hạ vẫn đứng, chỉ còn nguy cơ tự phục hồi ở lần refresh sau
    // (best-effort, không rollback role vì role change tự nó luôn đúng ý admin).
    const revoked = await this.rbac.revokeGrantsAbove(normalized, role).catch((err) => {
      this.logger.error(`revokeGrantsAbove lỗi cho SĐT ${normalized}: ${err instanceof Error ? err.message : err}`);
      return 0;
    });
    if (revoked > 0) {
      this.logger.warn(`Admin ${adminId} đổi role user ${user.id} (${normalized}) → thu hồi ${revoked} grant xếp hạng cao hơn ${role}.`);
    }
    this.logger.warn(`Admin ${adminId} đổi role user ${user.id} (${normalized}): ${previousRole} → ${role}`);
    return { ok: true, ...updated, previousRole };
  }

  async getDashboardStats() {
    const [
      totalOrders,
      pendingOrders,
      shippingOrders,
      deliveredOrders,
      cancelledOrders,
      revenueResult,
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
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: { status: { in: ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] } },
      }),
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

    return {
      totalRevenue: revenueResult._sum.total ?? 0,
      totalOrders,
      pendingOrders,
      shippingOrders,
      deliveredOrders,
      cancelledOrders,
      totalUsers,
      totalAffiliates,
      totalProducts,
      plantedTreesCount,
      recentOrders,
    };
  }

  async listOrders(page: number, limit: number, status?: string, search?: string) {
    const where: Prisma.OrderWhereInput = {};
    if (status) where.status = status as never;
    if (search && search.trim()) {
      const s = search.trim();
      where.OR = [
        { code: { contains: s, mode: 'insensitive' } },
        { user: { phone: { contains: s } } },
        { user: { fullName: { contains: s, mode: 'insensitive' } } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        include: {
          items: true,
          user: { select: { id: true, phone: true, fullName: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(items, page, limit, total);
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

  // ── SystemConfig ──
  getConfig(category?: string) {
    return category
      ? this.config.getByCategory(category)
      : this.prisma.systemConfig.findMany({ orderBy: { category: 'asc' } });
  }

  async setConfig(adminId: string, key: string, value: object | string | number | boolean) {
    await this.config.set(key, value, adminId);
    return { ok: true, key, value };
  }

  // ── Coupons ──
  createCoupon(data: {
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
    return this.prisma.coupon.create({
      data: {
        code: data.code,
        type: data.type,
        value: data.value,
        minOrder: data.minOrder,
        maxDiscount: data.maxDiscount,
        startAt: new Date(data.startAt),
        endAt: new Date(data.endAt),
        usageLimit: data.usageLimit,
        perUserLimit: data.perUserLimit ?? 1,
        scope: data.scope,
        // Trước đây KHÔNG ghi scopeMeta → coupon scope TIER/USER_GROUP tạo ra fail-closed ở MỌI
        // user trong isCouponEligible (coupon-scope.ts) — KHÔNG AI DÙNG ĐƯỢC, không lỗi khi tạo.
        scopeMeta: data.scopeMeta ? (data.scopeMeta as object) : undefined,
      },
    });
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

  /** Lịch sử đổi giá đại lý (mới nhất trước), lọc theo variation nếu có. */
  async getDealerPriceHistory(variationId: string | undefined, page: number, limit: number) {
    const where = variationId ? { variationId } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dealerPriceHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
      }),
      this.prisma.dealerPriceHistory.count({ where }),
    ]);
    return paginated(items, page, limit, total);
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
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');

    // CAS theo trạng thái đã đọc: hai admin cùng mở danh sách chờ duyệt, A bấm Duyệt còn B bấm
    // Từ chối hai giây sau thì trước đây B ghi đè kết quả của A mà A không hề biết. Nay người
    // thứ hai nhận lỗi rõ ràng thay vì lặng lẽ lật ngược quyết định.
    const moved = await this.prisma.product.updateMany({
      where: { id: productId, approvalStatus: product.approvalStatus },
      data: {
        approvalStatus: approve ? 'APPROVED' : 'REJECTED',
        rejectReason: approve ? null : (rejectReason ?? 'Không đạt tiêu chuẩn xanh của Tubu Tree'),
      },
    });
    if (moved.count === 0) {
      throw new BadRequestException('Sản phẩm vừa được người khác xử lý — tải lại danh sách để xem trạng thái mới.');
    }
    const updated = await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });

    this.logger.warn(
      `Admin ${adminId} đã ${approve ? 'DUYỆT' : 'TỪ CHỐI'} sản phẩm đối tác ${productId} (${product.name})`,
    );

    return updated;
  }
}
