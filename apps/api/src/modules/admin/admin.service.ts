import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { paginated, skipTake } from '../../common/pagination';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

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
      await this.prisma.$transaction([
        this.prisma.dealerApplication.update({
          where: { id },
          data: { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
        }),
        this.prisma.user.update({
          where: { id: app.userId },
          data: { role: 'DEALER', metadata: { dealerTierId: tierId } },
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
