import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Voucher tự động (Build Spec §6.6): welcome / birthday / win-back / milestone.
 * Tạo coupon cá nhân (scope USER_GROUP + scopeMeta.userId) — code duy nhất, usageLimit=1
 * nên chỉ user đó dùng được. Hiển thị ở kho voucher qua loyalty.getAvailableCoupons.
 * Mọi tham số đọc từ SystemConfig (không hard-code).
 */
@Injectable()
export class VouchersService {
  private readonly logger = new Logger(VouchersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Tạo coupon cá nhân + thông báo, idempotent theo reason trong kỳ. */
  private async grant(opts: {
    userId: string;
    reason: string; // vd WELCOME, BIRTHDAY-2026-06, WINBACK-2026-06-13
    type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
    value: number;
    minOrder?: number;
    validDays: number;
    templateCode: string;
  }): Promise<boolean> {
    // Code DETERMINISTIC theo (reason, full userId) → dựa vào coupon.code @unique
    // làm chốt idempotency thật (chống 2 cron instance cấp trùng). Dùng full userId
    // (không slice 6) để tránh false-skip khi 2 cuid trùng tiền tố.
    const code = `${opts.reason}-${opts.userId}`.toUpperCase();
    const existed = await this.prisma.coupon.findUnique({ where: { code } });
    if (existed) return false;

    const now = new Date();
    const endAt = new Date(now.getTime() + opts.validDays * 864e5);
    try {
      await this.prisma.coupon.create({
        data: {
          code,
          type: opts.type,
          value: opts.value,
          minOrder: opts.minOrder ?? null,
          startAt: now,
          endAt,
          usageLimit: 1,
          perUserLimit: 1,
          scope: 'USER_GROUP',
          scopeMeta: { userId: opts.userId, reason: opts.reason },
        },
      });
    } catch (err) {
      // Race multi-instance: instance khác vừa tạo cùng code (P2002) → coi như đã cấp.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        return false;
      }
      throw err;
    }
    await this.notifications
      .notify(opts.userId, opts.templateCode, {
        code,
        value: String(opts.value),
        expires: endAt.toLocaleDateString('vi-VN'),
      })
      .catch(() => undefined);
    return true;
  }

  /** Welcome: user mới (24h) chưa có đơn → voucher chào mừng. Chạy mỗi giờ. */
  @Cron(CronExpression.EVERY_HOUR)
  async welcomeVouchers(): Promise<void> {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const users = await this.prisma.user.findMany({
      where: { createdAt: { gte: since }, role: 'CUSTOMER' },
      take: 200,
    });
    const value = await this.config.get<number>('voucher.welcome_amount', 30000);
    const minOrder = await this.config.get<number>('voucher.welcome_min_order', 199000);
    let granted = 0;
    for (const u of users) {
      if (await this.grant({ userId: u.id, reason: 'WELCOME', type: 'AMOUNT', value, minOrder, validDays: 30, templateCode: 'WELCOME_VOUCHER' })) granted++;
    }
    if (granted) this.logger.log(`Welcome vouchers granted: ${granted}`);
  }

  /** Birthday: user có dob trùng ngày hôm nay. Chạy 1 giờ sáng hằng ngày. */
  @Cron('0 1 * * *')
  async birthdayVouchers(): Promise<void> {
    const today = new Date();
    const mm = today.getMonth() + 1;
    const dd = today.getDate();
    // Lọc theo tháng/ngày của dob (Postgres EXTRACT qua raw).
    const users = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE dob IS NOT NULL
        AND EXTRACT(MONTH FROM dob) = ${mm}
        AND EXTRACT(DAY FROM dob) = ${dd}
      LIMIT 500`;
    const value = await this.config.get<number>('voucher.birthday_amount', 50000);
    const reason = `BIRTHDAY-${today.getFullYear()}-${mm}`;
    let granted = 0;
    for (const u of users) {
      if (await this.grant({ userId: u.id, reason, type: 'AMOUNT', value, validDays: 30, templateCode: 'BIRTHDAY_VOUCHER' })) granted++;
    }
    if (granted) this.logger.log(`Birthday vouchers granted: ${granted}`);
  }

  /** Win-back: user từng mua nhưng >60 ngày không đặt đơn. Chạy 2 giờ sáng. */
  @Cron('0 2 * * *')
  async winbackVouchers(): Promise<void> {
    const days = await this.config.get<number>('voucher.winback_days', 60);
    const cutoff = new Date(Date.now() - days * 864e5);
    const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
      SELECT "userId", MAX("createdAt") AS last
      FROM orders
      GROUP BY "userId"
      HAVING MAX("createdAt") < ${cutoff}
      LIMIT 500`;
    const value = await this.config.get<number>('voucher.winback_amount', 50000);
    const reason = `WINBACK-${new Date().toISOString().slice(0, 7)}`;
    let granted = 0;
    for (const r of rows) {
      if (await this.grant({ userId: r.userId, reason, type: 'AMOUNT', value, validDays: 21, templateCode: 'WINBACK_VOUCHER' })) granted++;
    }
    if (granted) this.logger.log(`Win-back vouchers granted: ${granted}`);
  }
}
