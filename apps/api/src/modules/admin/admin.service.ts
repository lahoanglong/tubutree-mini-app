import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginated, skipTake } from '../../common/pagination';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly loyalty: LoyaltyService,
    private readonly affiliate: AffiliateService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Đổi/trả (§6.4) ──
  listReturnRequests(status?: string) {
    return this.prisma.returnRequest.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
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
      return this.prisma.returnRequest.findUnique({ where: { id } });
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
      // Hoàn đúng KÊNH thanh toán + restock trong CÙNG transaction.
      // - WALLET/ZALOPAY + PAID: hoàn về Ví Tubu (instant) vì khách đã trả tiền thật.
      // - COD UNPAID: KHÔNG hoàn ví (khách chưa trả gì cả → ví không tăng).
      // - COD đã giao mà PAID (ship đã thu hộ): hoàn ví (instant) như kênh prepaid.
      // - XU + PAID: hoàn lại XU (coinsBalance) + ghi CoinTransaction(+total), KHÔNG hoàn ví
      //   (xu không rút được; hoàn vào ví = biến xu thành tiền rút được = leak giá trị).
      const wasPaidToWallet =
        order.paymentStatus === 'PAID' &&
        (order.paymentMethod === 'WALLET' || order.paymentMethod === 'ZALOPAY' || order.paymentMethod === 'COD');
      const wasPaidWithXu = order.paymentStatus === 'PAID' && order.paymentMethod === 'XU';

      // Guard status='DELIVERED' để KHÔNG đè CANCELLED/RETURNED (đơn đã hủy đã hoàn
      // ví ở orders.cancel — nếu đè thêm RETURNED rồi hoàn ví nữa = DOUBLE refund).
      const flipped = await tx.order.updateMany({
        where: { id: order.id, status: 'DELIVERED' },
        data: { status: 'RETURNED' },
      });
      if (flipped.count === 0) {
        throw new BadRequestException('Đơn không ở trạng thái có thể trả (đã hủy/đã trả).');
      }
      if (wasPaidToWallet) {
        await tx.user.update({
          where: { id: order.userId },
          data: { walletBalance: { increment: order.total } },
        });
      } else if (wasPaidWithXu) {
        await tx.user.update({
          where: { id: order.userId },
          data: { coinsBalance: { increment: order.total } },
        });
        await tx.coinTransaction.create({
          data: {
            userId: order.userId,
            delta: order.total,
            reason: `ORDER_REFUND:${order.code}`,
            refType: 'ORDER',
            refId: order.id,
          },
        });
      }
      // Hoàn stock — chỉ ở nhánh THẮNG để tránh restock 2 lần.
      for (const item of order.items) {
        await tx.variation.update({
          where: { id: item.variationId },
          data: { stock: { increment: item.quantity } },
        });
      }
    });
    // Reverse điểm Xanh + commission CTV + notify (idempotent — để ngoài tx an toàn).
    await this.loyalty.reverseOrderPoints(orderForReturn.id);
    await this.affiliate.reverseCommissionsForOrder(orderForReturn.id);
    await this.notifications
      .notify(orderForReturn.userId, 'RETURN_APPROVED', { order_code: orderForReturn.code })
      .catch(() => undefined);
    return this.prisma.returnRequest.findUnique({ where: { id } });
  }

  // ── Dealer applications ──
  listDealerApplications(status?: string) {
    return this.prisma.dealerApplication.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
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
      await this.prisma.$transaction([
        this.prisma.dealerApplication.update({
          where: { id },
          data: { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
        }),
        this.prisma.user.update({
          where: { id: app.userId },
          data: { role: 'DEALER', metadata: mergedMeta },
        }),
      ]);
    } else {
      await this.prisma.dealerApplication.update({
        where: { id },
        data: { status: 'REJECTED', reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: reason },
      });
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

  async listOrders(page: number, limit: number, status?: string) {
    const where = status ? { status: status as never } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        include: { items: true },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(items, page, limit, total);
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
      },
    });
  }
}
