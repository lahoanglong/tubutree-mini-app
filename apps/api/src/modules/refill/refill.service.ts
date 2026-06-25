import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * Refill / đổi vỏ chai (§6.14.6). Khách mang vỏ chai rỗng đến đổi → thưởng 💧 (nước tưới Vườn Xanh)
 * tức thì, có TRẦN theo tháng chống lạm dụng. Phần thưởng là 💧 (không phải tiền) nên rủi ro thấp;
 * gắn với chủ đề eco: tái chế vỏ → nuôi cây thật. Tổng vỏ đã tái chế hiển thị như "dấu chân xanh".
 */
@Injectable()
export class RefillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async returnBottles(userId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Số vỏ chai không hợp lệ.');
    }
    const [perBottle, monthlyCap] = await Promise.all([
      this.config.get<number>('refill.seeds_per_bottle', 50),
      this.config.get<number>('refill.monthly_cap_bottles', 20),
    ]);
    const used = await this.usedThisMonth(userId);
    const remaining = Math.max(0, monthlyCap - used);
    if (quantity > remaining) {
      throw new BadRequestException(`Tháng này bạn chỉ còn đổi được ${remaining} vỏ chai (trần ${monthlyCap}/tháng).`);
    }

    const seedsAwarded = quantity * perBottle;
    await this.prisma.$transaction(async (tx) => {
      // Cộng 💧 vào bình chung của vườn (tạo hồ sơ game nếu user chưa từng chơi).
      await tx.gameProfile.upsert({
        where: { userId },
        create: { userId, totalSeeds: seedsAwarded },
        update: { totalSeeds: { increment: seedsAwarded } },
      });
      await tx.bottleReturn.create({ data: { userId, quantity, seedsAwarded } });
    });

    const totalRecycled = await this.totalRecycled(userId);
    return { quantity, seedsAwarded, monthlyRemaining: remaining - quantity, totalRecycled };
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
      history: recent.map((r) => ({ id: r.id, quantity: r.quantity, seedsAwarded: r.seedsAwarded, createdAt: r.createdAt })),
    };
  }

  private async usedThisMonth(userId: string): Promise<number> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const agg = await this.prisma.bottleReturn.aggregate({
      where: { userId, createdAt: { gte: start } },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  private async totalRecycled(userId: string): Promise<number> {
    const agg = await this.prisma.bottleReturn.aggregate({ where: { userId }, _sum: { quantity: true } });
    return agg._sum.quantity ?? 0;
  }
}
