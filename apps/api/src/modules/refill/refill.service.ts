import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Refill / đổi vỏ chai (§6.14.6). Khách mang vỏ chai rỗng đến đổi → gửi yêu cầu (PENDING).
 * Quản lý (Admin/Staff) xem & duyệt đơn trên trang Quản trị → tự động thưởng 💧 vào Vườn Xanh.
 */
@Injectable()
export class RefillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async returnBottles(userId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Số vỏ chai không hợp lệ.');
    }
    const [perBottle, monthlyCap] = await Promise.all([
      this.config.get<number>('refill.seeds_per_bottle', 50),
      this.config.get<number>('refill.monthly_cap_bottles', 20),
    ]);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const used = await this.usedThisMonthTx(tx, userId);
          const remaining = Math.max(0, monthlyCap - used);
          if (quantity > remaining) {
            throw new BadRequestException(`Tháng này bạn chỉ còn đổi được ${remaining} vỏ chai (trần ${monthlyCap}/tháng).`);
          }

          const seedsAwarded = quantity * perBottle;
          const item = await tx.bottleReturn.create({
            data: { userId, quantity, seedsAwarded, status: 'PENDING' },
          });

          const totalRecycled = await this.totalRecycledTx(tx, userId);
          return {
            id: item.id,
            quantity,
            seedsAwarded,
            status: 'PENDING',
            monthlyRemaining: remaining - quantity,
            totalRecycled,
          };
        },
        // Serializable: đọc SUM tháng rồi INSERT không phải 1 phép atomic (không có cột đếm
        // để updateMany+gte như stock/wallet) — 2 request đổi vỏ song song đọc CÙNG "used" rồi
        // đều pass trần → vượt monthly_cap_bottles. Serializable buộc 1 trong 2 tx fail (P2034)
        // thay vì âm thầm double-count (mirror dealer.service.ts credit-limit check).
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận xử lý, vui lòng thử lại.');
      }
      throw err;
    }
  }

  async getSummary(userId: string) {
    const [perBottle, monthlyCap, monthlyUsed, totalRecycled, recent] = await Promise.all([
      this.config.get<number>('refill.seeds_per_bottle', 50),
      this.config.get<number>('refill.monthly_cap_bottles', 20),
      this.usedThisMonth(userId),
      this.totalRecycled(userId),
      this.prisma.bottleReturn.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return {
      perBottle,
      monthlyCap,
      monthlyUsed,
      monthlyRemaining: Math.max(0, monthlyCap - monthlyUsed),
      totalRecycled,
      history: recent.map((r) => ({
        id: r.id,
        quantity: r.quantity,
        seedsAwarded: r.seedsAwarded,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  }

  async listPending() {
    return this.prisma.bottleReturn.findMany({
      where: { status: 'PENDING' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async approveReturn(id: string) {
    const item = await this.prisma.bottleReturn.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Không tìm thấy yêu cầu đổi vỏ.');
    if (item.status !== 'PENDING') throw new BadRequestException('Yêu cầu này đã được xử lý.');

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bottleReturn.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPROVED' },
      });
      if (updated.count === 0) {
        throw new BadRequestException('Yêu cầu này đã được xử lý hoặc không hợp lệ.');
      }
      await tx.gameProfile.upsert({
        where: { userId: item.userId },
        create: { userId: item.userId, totalSeeds: item.seedsAwarded },
        update: { totalSeeds: { increment: item.seedsAwarded } },
      });
      await tx.notificationLog.create({
        data: {
          userId: item.userId,
          templateCode: 'REFILL_APPROVED',
          channel: 'INAPP',
          payload: {
            title: 'Đổi vỏ chai thành công!',
            body: `Yêu cầu đổi ${item.quantity} vỏ chai của bạn đã được duyệt (+${item.seedsAwarded} 💧 tưới cây).`,
          },
          status: 'SENT',
        },
      });
    });

    return { ok: true, status: 'APPROVED' };
  }

  async rejectReturn(id: string) {
    const item = await this.prisma.bottleReturn.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Không tìm thấy yêu cầu đổi vỏ.');
    if (item.status !== 'PENDING') throw new BadRequestException('Yêu cầu này đã được xử lý.');

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bottleReturn.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });
      if (updated.count === 0) {
        throw new BadRequestException('Yêu cầu này đã được xử lý hoặc không hợp lệ.');
      }
      await tx.notificationLog.create({
        data: {
          userId: item.userId,
          templateCode: 'REFILL_REJECTED',
          channel: 'INAPP',
          payload: {
            title: 'Yêu cầu đổi vỏ chai từ chối',
            body: `Yêu cầu đổi ${item.quantity} vỏ chai của bạn chưa hợp lệ hoặc bị từ chối.`,
          },
          status: 'SENT',
        },
      });
    });

    return { ok: true, status: 'REJECTED' };
  }

  private async usedThisMonth(userId: string): Promise<number> {
    return this.usedThisMonthTx(this.prisma, userId);
  }

  private async usedThisMonthTx(client: Prisma.TransactionClient | PrismaService, userId: string): Promise<number> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const agg = await client.bottleReturn.aggregate({
      where: { userId, status: { in: ['APPROVED', 'PENDING'] }, createdAt: { gte: start } },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  private async totalRecycled(userId: string): Promise<number> {
    return this.totalRecycledTx(this.prisma, userId);
  }

  private async totalRecycledTx(client: Prisma.TransactionClient | PrismaService, userId: string): Promise<number> {
    const agg = await client.bottleReturn.aggregate({
      where: { userId, status: 'APPROVED' },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }
}
