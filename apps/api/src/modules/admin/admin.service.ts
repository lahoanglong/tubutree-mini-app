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
import { GomdonOrderService } from '../integrations/gomdon/gomdon-order.service';
import { GomdonClient } from '../integrations/gomdon/gomdon.client';
import { GOMDON_RECYCLING_TOGGLE_KEY } from '../integrations/gomdon/gomdon-config';
import { buildAdminOrderWhere, type RecyclingFilter } from './admin-order-filter';
import { redactConfigRows, redactValueForKey, restoreRedactedSecrets } from './config-redaction';
import { validateAdminConfigValue } from './admin-config-rules';

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

  // ── Đổi/trả (§6.4) ──
  /**
   * Kèm đơn + khách: portal web render `r.order?.code`, `r.user?.fullName`, tổng đơn và phương
   * thức thanh toán, nhưng trước đây truy vấn không include gì cả — admin chỉ thấy một dãy cuid
   * và chữ "Khách hàng", rồi bấm Duyệt để hoàn nguyên tổng đơn về ví mà KHÔNG nhìn thấy số tiền
   * mình đang hoàn.
   */
  async listReturnRequests(status: string | undefined, page: number, limit: number, order?: 'asc' | 'desc') {
    const where = status ? { status: status as never } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.returnRequest.findMany({
        where,
        // Hàng chờ duyệt (REQUESTED) web gửi order=asc — yêu cầu cũ nhất lên đầu, không bị chìm.
        orderBy: { createdAt: order ?? 'desc' },
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
    // A6-06 (phần thông báo, docs/audit-2026-09/06-web.md): trước đây LUÔN gửi "Tiền đã hoàn vào
    // Ví Tubu" bất kể reverseFinancials có thực sự chi tiền hay không (vd đơn chưa từng thanh toán
    // thật dù đã DELIVERED — xem A5-03/A6-02 "giao ảo" — hoặc đã bị hoàn bởi một đường khác trước
    // đó). moneyRefunded lấy TRỰC TIẾP từ guard hoàn tiền trong CÙNG transaction, không phải suy
    // đoán ở ngoài, nên phản ánh đúng có tiền thực sự được chi hay không.
    let moneyRefunded = false;
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
      ({ moneyRefunded } = await this.reversal.reverseFinancials(tx, order));
    });
    // Reverse điểm Xanh + commission CTV + notify (idempotent — để ngoài tx an toàn).
    await this.loyalty.reverseOrderPoints(orderForReturn.id);
    await this.affiliate.reverseCommissionsForOrder(orderForReturn.id);
    // KHÔNG được báo "đã hoàn tiền" nếu thực tế không có khoản hoàn nào được chi (xem comment ở
    // trên) — dùng template trung tính, chỉ xác nhận đã duyệt trả hàng.
    await this.notifications
      .notify(orderForReturn.userId, moneyRefunded ? 'RETURN_APPROVED' : 'RETURN_APPROVED_NO_REFUND', {
        order_code: orderForReturn.code,
      })
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

  /**
   * Danh sách đơn cho admin. `include` (không `select`) nên trả ĐỦ cột vô hướng của Order — gồm
   * hasRecyclingPickup/recyclingNote/gomdonStatus/gomdonPartnerCode/gomdonCancelStatus/deliveredAt mà
   * web admin cần để hiện thu gom. `recycling='attention'` = hàng đợi "Cần xử lý thu gom"
   * (xem admin-order-filter.ts).
   */
  async listOrders(page: number, limit: number, status?: string, search?: string, recycling?: RecyclingFilter) {
    const where: Prisma.OrderWhereInput = buildAdminOrderWhere({ status, search, recycling });
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
    // Đơn đại lý: gắn cờ "Ghi công nợ" (có dòng DealerCreditLedger refType=ORDER — đúng điều kiện
    // DealerService.confirmDealerOrderPayment dùng để từ chối). Đơn công nợ cũng BANK_TRANSFER + UNPAID
    // nên màn admin không tự phân biệt được với đơn trả trước đang chờ chuyển khoản; không có cờ này thì
    // nút "Xác nhận đã nhận chuyển khoản" hiện cả trên đơn công nợ rồi bấm vào mới bị từ chối.
    const dealerIds = items.filter((o) => o.type === 'DEALER').map((o) => o.id);
    if (dealerIds.length === 0) return paginated(items, page, limit, total);
    const debits = await this.prisma.dealerCreditLedger.findMany({
      where: { refType: 'ORDER', refId: { in: dealerIds } },
      select: { refId: true },
    });
    const onCredit = new Set(debits.map((d) => d.refId));
    const data = items.map((o) => (o.type === 'DEALER' ? { ...o, dealerOnCredit: onCredit.has(o.id) } : o));
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
  async markGomdonHandled(adminId: string, idOrCode: string, note?: string) {
    const order = await this.resolveOrderRef(idOrCode);
    const cleanNote = note?.trim().replace(/\s+/g, ' ').slice(0, 500);
    try {
      const res = await this.gomdonOrder.markHandled(order.id);
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
    };
  }

  // ── SystemConfig ──
  /**
   * Đọc config cho admin — MỌI khoá/field khớp /password|secret|token/i bị che (đệ quy trong JSON),
   * xem config-redaction.ts. Trước đây trả nguyên văn, kể cả mật khẩu Gomdon bản WIP lưu trong
   * shipping.gomdon.config.
   */
  async getConfig(category?: string) {
    if (category) return redactConfigRows(await this.config.getByCategory(category));
    return redactConfigRows(await this.prisma.systemConfig.findMany({ orderBy: { category: 'asc' } }));
  }

  /**
   * Ghi config. GET đã che bí mật nên form JSON thô gửi lại chuỗi che khi admin bấm Lưu — khôi phục giá
   * trị thật ở đúng chỗ đó (restoreRedactedSecrets) thay vì ghi đè mật khẩu bằng "••••". Khoá có form
   * riêng (Gomdon, tích điểm) được kiểm luật trước khi ghi (admin-config-rules.ts).
   */
  async setConfig(adminId: string, key: string, value: object | string | number | boolean) {
    const existing = await this.prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
    const restored = restoreRedactedSecrets(key, value, existing?.value) as object | string | number | boolean;
    validateAdminConfigValue(key, restored);
    await this.config.set(key, restored, adminId);
    this.logger.warn(`Admin ${adminId} cập nhật cấu hình ${key}.`);
    return { ok: true, key, value: redactValueForKey(key, restored) };
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
