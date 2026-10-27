import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { isRealUser } from '../../common/real-user';
import { startOfNextVnWeek, startOfVnWeek } from '../../common/vn-time';
import { ORDER_WATER_REASON, ORDER_WATER_SEEDS_DEFAULT, ORDER_WATER_WEEKLY_CAP_DEFAULT } from './game.constants';

export type OrderWaterResult =
  | { granted: number; skipped?: undefined; pending?: boolean }
  | { granted: 0; skipped: 'DISABLED' | 'NOT_DELIVERED' | 'NOT_ELIGIBLE' | 'ALREADY_GRANTED' };

/** Số giọt đơn hàng thưởng và phần đã nhận trong tuần giờ VN này (thứ Hai đến Chủ nhật), để màn game hiện tiến độ. */
export interface OrderWaterSummary {
  perOrder: number;
  weeklyCap: number;
  weeklyGranted: number;
  /** Nước của các đơn giao trước khi khách mở game, vừa cộng ở lần gọi này (chỉ lần mở đầu tiên có số > 0). */
  claimedNow: number;
}

@Injectable()
export class GameOrderWaterService {
  private readonly logger = new Logger(GameOrderWaterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /** Số nguyên không âm; âm, chuỗi lạ hay NaN coi là 0 (tắt) và cảnh báo, không rơi về mặc định (bật) ngoài ý admin. */
  private async offWhenInvalid(key: string, fallback: number): Promise<number> {
    const raw = await this.config.get<unknown>(key, fallback);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    this.logger.warn(`Cấu hình ${key} không hợp lệ (${JSON.stringify(raw)}): coi như tắt nước theo đơn`);
    return 0;
  }

  private async settings() {
    const [perOrder, weeklyCap] = await Promise.all([
      this.offWhenInvalid('game.order_seeds', ORDER_WATER_SEEDS_DEFAULT),
      this.offWhenInvalid('game.order_seeds_weekly_cap', ORDER_WATER_WEEKLY_CAP_DEFAULT),
    ]);
    return { perOrder, weeklyCap };
  }

  /** Tiến độ tuần; gọi sau `claimPending` để số đã gồm đơn chờ vừa cộng. */
  async summary(userId: string, claimedNow = 0, now: Date = new Date()): Promise<OrderWaterSummary> {
    const { perOrder, weeklyCap } = await this.settings();
    const agg = await this.prisma.gameWaterEvent.aggregate({
      _sum: { delta: true },
      where: { userId, reason: ORDER_WATER_REASON, createdAt: { gte: startOfVnWeek(now), lt: startOfNextVnWeek(now) } },
    });
    return { perOrder, weeklyCap, weeklyGranted: agg._sum.delta ?? 0, claimedNow };
  }

  /**
   * Cộng nước cho đơn đã giao, đúng một lần cho mỗi lần thanh toán (unique reason+refId; nhiều kiện cùng `checkoutGroup` là một
   * lần), tối đa `game.order_seeds_weekly_cap` mỗi tuần VN. Nước theo đơn KHÔNG bị giới hạn bởi sức chứa bình: bình chỉ cắt các
   * nguồn hằng ngày. Khoá theo thứ tự users rồi game_profiles (như spin và Đổi rác); hai đơn của cùng khách giao song song
   * không cùng đọc "còn chỗ" rồi cùng vượt trần. Đơn bị chặn bởi trần tuần vẫn ghi một dòng delta 0: đơn đó đã xét xong, cron
   * chạy lại ở tuần sau không cộng bù. Khách chưa có hồ sơ game KHÔNG bị tạo hồ sơ (hồ sơ rỗng làm gộp tài khoản tưởng là đã
   * chơi): đơn ghi ở trạng thái chờ và cộng khi khách mở game lần đầu (xem `claimPending`).
   */
  async grantForOrder(orderId: string, now: Date = new Date()): Promise<OrderWaterResult> {
    const { perOrder, weeklyCap } = await this.settings();
    if (perOrder <= 0 || weeklyCap <= 0) return { granted: 0, skipped: 'DISABLED' };

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, status: true, placedForCustomer: true, checkoutGroup: true },
    });
    if (!order || order.status !== 'DELIVERED') return { granted: 0, skipped: 'NOT_DELIVERED' };
    // Đơn CTV lên hộ khách mang userId của CTV: nước thưởng mua hàng không thuộc về người lên đơn.
    if (order.placedForCustomer) return { granted: 0, skipped: 'NOT_ELIGIBLE' };
    const owner = await this.prisma.user.findUnique({ where: { id: order.userId }, select: { zaloId: true, phone: true } });
    if (!isRealUser(owner)) return { granted: 0, skipped: 'NOT_ELIGIBLE' };

    const refId = order.checkoutGroup ? `grp:${order.checkoutGroup}` : order.id;
    const weekStart = startOfVnWeek(now);
    const weekEnd = startOfNextVnWeek(now);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${order.userId} FOR UPDATE`;
        const profile = await tx.$queryRaw<{ userId: string }[]>`
          SELECT "userId" FROM "game_profiles" WHERE "userId" = ${order.userId} FOR UPDATE`;
        const existing = await tx.gameWaterEvent.findUnique({
          where: { reason_refId: { reason: ORDER_WATER_REASON, refId } },
          select: { id: true },
        });
        if (existing) return { granted: 0, skipped: 'ALREADY_GRANTED' as const };

        if (profile.length === 0) {
          await tx.gameWaterEvent.create({
            data: { userId: order.userId, delta: 0, reason: ORDER_WATER_REASON, refId, pending: true, createdAt: now },
          });
          return { granted: 0, pending: true };
        }

        const used = await tx.gameWaterEvent.aggregate({
          _sum: { delta: true },
          where: { userId: order.userId, reason: ORDER_WATER_REASON, createdAt: { gte: weekStart, lt: weekEnd } },
        });
        const granted = Math.min(perOrder, Math.max(0, weeklyCap - (used._sum.delta ?? 0)));
        await tx.gameWaterEvent.create({
          data: { userId: order.userId, delta: granted, reason: ORDER_WATER_REASON, refId, createdAt: now },
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

  /**
   * Gọi khi hồ sơ game của khách đã tồn tại (lần mở game đầu). Cộng các đơn chờ của TUẦN VN HIỆN TẠI, cũ nhất trước, qua cùng
   * khoá dòng và cùng trần tuần; đơn chờ của tuần trước chỉ được đóng (không cộng bù). Trả số giọt vừa cộng.
   */
  async claimPending(userId: string, now: Date = new Date()): Promise<number> {
    const pendingCount = await this.prisma.gameWaterEvent.count({ where: { userId, reason: ORDER_WATER_REASON, pending: true } });
    if (pendingCount === 0) return 0;
    const { perOrder, weeklyCap } = await this.settings();
    const weekStart = startOfVnWeek(now);
    const weekEnd = startOfNextVnWeek(now);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const profile = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "game_profiles" WHERE "userId" = ${userId} FOR UPDATE`;
      if (profile.length === 0) return 0;
      const pending = await tx.gameWaterEvent.findMany({
        where: { userId, reason: ORDER_WATER_REASON, pending: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true },
      });
      const used = await tx.gameWaterEvent.aggregate({
        _sum: { delta: true },
        where: { userId, reason: ORDER_WATER_REASON, pending: false, createdAt: { gte: weekStart, lt: weekEnd } },
      });
      let weekLeft = Math.max(0, weeklyCap - (used._sum.delta ?? 0));
      let total = 0;
      for (const ev of pending) {
        const inWeek = ev.createdAt >= weekStart && ev.createdAt < weekEnd;
        const give = inWeek && perOrder > 0 ? Math.min(perOrder, weekLeft) : 0;
        weekLeft -= give;
        total += give;
        await tx.gameWaterEvent.update({ where: { id: ev.id }, data: { pending: false, delta: give } });
      }
      if (total > 0) await tx.gameProfile.update({ where: { userId }, data: { totalSeeds: { increment: total } } });
      return total;
    });
  }
}
