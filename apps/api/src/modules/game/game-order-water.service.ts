import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { isRealUser } from '../../common/real-user';
import { startOfNextVnWeek, startOfVnWeek } from '../../common/vn-time';
import { ensureGameProfile } from './game-profile';
import { ORDER_WATER_REASON, ORDER_WATER_SEEDS_DEFAULT, ORDER_WATER_WEEKLY_CAP_DEFAULT, configInt } from './game.constants';

export type OrderWaterResult =
  | { granted: number; skipped?: undefined }
  | { granted: 0; skipped: 'DISABLED' | 'NOT_DELIVERED' | 'NOT_ELIGIBLE' | 'ALREADY_GRANTED' };

/** Số giọt đơn hàng thưởng và phần đã nhận trong tuần giờ VN này (thứ Hai đến Chủ nhật), để màn game hiện tiến độ. */
export interface OrderWaterSummary {
  perOrder: number;
  weeklyCap: number;
  weeklyGranted: number;
}

@Injectable()
export class GameOrderWaterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  private async settings() {
    const [perOrder, weeklyCap] = await Promise.all([
      configInt(this.config, 'game.order_seeds', ORDER_WATER_SEEDS_DEFAULT),
      configInt(this.config, 'game.order_seeds_weekly_cap', ORDER_WATER_WEEKLY_CAP_DEFAULT),
    ]);
    return { perOrder, weeklyCap };
  }

  async summary(userId: string, now: Date = new Date()): Promise<OrderWaterSummary> {
    const { perOrder, weeklyCap } = await this.settings();
    const agg = await this.prisma.gameWaterEvent.aggregate({
      _sum: { delta: true },
      where: { userId, reason: ORDER_WATER_REASON, createdAt: { gte: startOfVnWeek(now), lt: startOfNextVnWeek(now) } },
    });
    return { perOrder, weeklyCap, weeklyGranted: agg._sum.delta ?? 0 };
  }

  /**
   * Cộng nước cho đơn đã giao, đúng một lần cho mỗi đơn (unique reason+refId), tối đa `game.order_seeds_weekly_cap` mỗi tuần VN.
   * Hồ sơ game của khách bị khoá dòng suốt giao dịch nên hai đơn của cùng khách giao song song không cùng đọc "còn chỗ" rồi
   * cùng vượt trần. Đơn bị chặn bởi trần tuần hoặc bình đầy vẫn ghi một dòng delta 0: đơn đó đã xét xong, cron chạy lại ở tuần
   * sau không cộng bù. Khách chưa từng mở game được tạo hồ sơ rỗng để nhận nước.
   */
  async grantForOrder(orderId: string, now: Date = new Date()): Promise<OrderWaterResult> {
    const { perOrder, weeklyCap } = await this.settings();
    if (perOrder <= 0 || weeklyCap <= 0) return { granted: 0, skipped: 'DISABLED' };

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, status: true, placedForCustomer: true },
    });
    if (!order || order.status !== 'DELIVERED') return { granted: 0, skipped: 'NOT_DELIVERED' };
    // Đơn CTV lên hộ khách mang userId của CTV: nước thưởng mua hàng không thuộc về người lên đơn.
    if (order.placedForCustomer) return { granted: 0, skipped: 'NOT_ELIGIBLE' };
    const owner = await this.prisma.user.findUnique({ where: { id: order.userId }, select: { zaloId: true, phone: true } });
    if (!isRealUser(owner)) return { granted: 0, skipped: 'NOT_ELIGIBLE' };

    await ensureGameProfile(this.prisma, this.config, order.userId);
    const tankCap = await this.config.get<number>('game.tank_capacity', 500);
    const weekStart = startOfVnWeek(now);
    const weekEnd = startOfNextVnWeek(now);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [profile] = await tx.$queryRaw<{ totalSeeds: number }[]>`
          SELECT "totalSeeds" FROM "game_profiles" WHERE "userId" = ${order.userId} FOR UPDATE`;
        const existing = await tx.gameWaterEvent.findUnique({
          where: { reason_refId: { reason: ORDER_WATER_REASON, refId: order.id } },
          select: { id: true },
        });
        if (existing) return { granted: 0, skipped: 'ALREADY_GRANTED' as const };

        const used = await tx.gameWaterEvent.aggregate({
          _sum: { delta: true },
          where: { userId: order.userId, reason: ORDER_WATER_REASON, createdAt: { gte: weekStart, lt: weekEnd } },
        });
        const weekLeft = Math.max(0, weeklyCap - (used._sum.delta ?? 0));
        const tankLeft = Math.max(0, tankCap - (profile?.totalSeeds ?? 0));
        const granted = Math.min(perOrder, weekLeft, tankLeft);

        await tx.gameWaterEvent.create({
          data: { userId: order.userId, delta: granted, reason: ORDER_WATER_REASON, refId: order.id, createdAt: now },
        });
        if (granted > 0) {
          await tx.gameProfile.update({ where: { userId: order.userId }, data: { totalSeeds: { increment: granted } } });
        }
        return { granted };
      });
    } catch (e) {
      // Backstop của unique index nếu hai lần gọi vẫn cùng lọt qua bước kiểm trên.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { granted: 0, skipped: 'ALREADY_GRANTED' };
      }
      throw e;
    }
  }
}
