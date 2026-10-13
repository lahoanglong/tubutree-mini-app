import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { startOfVnMonth } from '../../common/vn-time';

/**
 * Refill / đổi vỏ chai (§6.14.6). Khách mang vỏ chai rỗng đến đổi → gửi yêu cầu (PENDING).
 * Quản lý (Admin/Staff) xem & duyệt đơn trên trang Quản trị → tự động thưởng 💧 vào Vườn Xanh.
 */
const LIST_PENDING_TAKE = 100;

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
    const [perBottle, monthlyCap, monthlyUsed, totalRecycled, recent, pickup] = await Promise.all([
      this.config.get<number>('refill.seeds_per_bottle', 50),
      this.config.get<number>('refill.monthly_cap_bottles', 20),
      this.usedThisMonth(userId),
      this.totalRecycled(userId),
      this.prisma.bottleReturn.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.pickupPoint(),
    ]);
    return {
      pickup,
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

  /** Cũ nhất trước để yêu cầu chờ lâu không bị đẩy khỏi hàng khi > 100; `cursor` = id dòng cuối trang trước. */
  async listPending(opts: { cursor?: string; take?: number } = {}) {
    const take = Math.max(1, Math.min(Math.trunc(opts.take ?? LIST_PENDING_TAKE) || LIST_PENDING_TAKE, LIST_PENDING_TAKE));
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
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
  }

  /**
   * Nhân viên đối chiếu vỏ tại điểm nhận rồi duyệt. `receivedQuantity` bỏ trống = nhận đủ số khách khai; nhập nhiều hơn
   * thì kẹp về số khai (không thưởng quá số khách xin). Nhận ít hơn: `quantity` thành số thực nhận (đếm trần tháng và
   * tổng đã tái chế theo vỏ thật), số khai ban đầu giữ ở `declaredQuantity`, 💧 theo số thực nhận.
   */
  async approveReturn(id: string, reviewerId: string, receivedQuantity?: number) {
    const item = await this.prisma.bottleReturn.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Không tìm thấy yêu cầu đổi vỏ.');
    if (item.status !== 'PENDING') throw new BadRequestException('Yêu cầu này đã được xử lý.');
    if (receivedQuantity !== undefined && (!Number.isInteger(receivedQuantity) || receivedQuantity < 1)) {
      throw new BadRequestException('Số vỏ thực nhận phải là số nguyên từ 1. Không nhận được vỏ nào thì hãy từ chối yêu cầu.');
    }
    const received = Math.min(receivedQuantity ?? item.quantity, item.quantity);
    const adjusted = received < item.quantity;
    const perBottle = item.quantity > 0 ? item.seedsAwarded / item.quantity : 0;
    const seeds = adjusted ? Math.round(received * perBottle) : item.seedsAwarded;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bottleReturn.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          ...(adjusted ? { quantity: received, declaredQuantity: item.quantity, seedsAwarded: seeds } : {}),
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException('Yêu cầu này đã được xử lý hoặc không hợp lệ.');
      }
      await tx.gameProfile.upsert({
        where: { userId: item.userId },
        create: { userId: item.userId, totalSeeds: seeds },
        update: { totalSeeds: { increment: seeds } },
      });
    });

    await this.notifications
      .notify(item.userId, 'REFILL_APPROVED', {
        quantity: String(received),
        seeds: String(seeds),
        note: adjusted ? ` (bạn khai ${item.quantity} vỏ)` : '',
      })
      .catch(() => undefined);

    return { ok: true, status: 'APPROVED' };
  }

  async rejectReturn(id: string, reviewerId: string, reason?: string) {
    const item = await this.prisma.bottleReturn.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Không tìm thấy yêu cầu đổi vỏ.');
    if (item.status !== 'PENDING') throw new BadRequestException('Yêu cầu này đã được xử lý.');
    const why = reason?.trim() || null;

    const updated = await this.prisma.bottleReturn.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: why },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Yêu cầu này đã được xử lý hoặc không hợp lệ.');
    }

    await this.notifications
      .notify(item.userId, 'REFILL_REJECTED', { quantity: String(item.quantity), reason: why ? `: ${why}` : '' })
      .catch(() => undefined);

    return { ok: true, status: 'REJECTED' };
  }

  /** Điểm nhận vỏ: admin điền ở SystemConfig refill.pickup_*; trống/sai kiểu → null để app ẩn dòng đó. */
  private async pickupPoint(): Promise<{ address: string | null; hours: string | null; phone: string | null }> {
    const text = async (key: string): Promise<string | null> => {
      const v = await this.config.get<unknown>(key, '');
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const [address, hours, phone] = await Promise.all([
      text('refill.pickup_address'),
      text('refill.pickup_hours'),
      text('refill.pickup_phone'),
    ]);
    return { address, hours, phone };
  }

  private async usedThisMonth(userId: string): Promise<number> {
    return this.usedThisMonthTx(this.prisma, userId);
  }

  private async usedThisMonthTx(client: Prisma.TransactionClient | PrismaService, userId: string): Promise<number> {
    const start = startOfVnMonth();
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
