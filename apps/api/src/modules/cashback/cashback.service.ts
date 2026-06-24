import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { CoinsService } from '../wallet/coins.service';
import { NotificationsService } from '../notifications/notifications.service';

interface AccesstradePostback {
  utm_content: string; // clickId
  order_id: string;
  amount: number;
  commission: number;
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * Cashback sàn ngoài qua Accesstrade (Build Spec §9, §15 cashback.*).
 * Tubu giữ margin, user nhận `merchant_user_share` (mặc định 70%).
 * Hold sau khi AT confirm `cashback.hold_days` (30) rồi mới về Ví.
 */
@Injectable()
export class CashbackService {
  private readonly logger = new Logger(CashbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly coins: CoinsService,
    private readonly notifications: NotificationsService,
  ) {}

  listMerchants() {
    return this.prisma.cashbackMerchant.findMany({ where: { isActive: true } });
  }

  /** Tạo click + sinh deeplink chứa clickId để AT postback. */
  async createClick(userId: string, merchantId: string, productUrl?: string) {
    const merchant = await this.prisma.cashbackMerchant.findUnique({ where: { id: merchantId } });
    if (!merchant || !merchant.isActive) throw new BadRequestException('Sàn không khả dụng.');

    const rateLimit = await this.config.get<number>('cashback.click_rate_limit_seconds', 30);
    const recent = await this.prisma.cashbackClick.findFirst({
      where: { userId, merchantId, clickedAt: { gte: new Date(Date.now() - rateLimit * 1000) } },
    });
    if (recent) {
      return { deeplink: this.buildDeeplink(merchant.deeplinkTemplate, recent.utmTraceId, productUrl) };
    }

    const clickId = randomUUID().replace(/-/g, '');
    const deeplink = this.buildDeeplink(merchant.deeplinkTemplate, clickId, productUrl);
    await this.prisma.cashbackClick.create({
      data: { userId, merchantId, utmTraceId: clickId, destinationUrl: deeplink, productUrl },
    });
    return { deeplink };
  }

  listTransactions(userId: string) {
    return this.prisma.cashbackTransaction.findMany({
      where: { userId },
      orderBy: { confirmedAt: 'desc' },
      take: 100,
    });
  }

  /** Webhook postback Accesstrade. Idempotent theo merchantOrderId. */
  async handlePostback(payload: AccesstradePostback) {
    // Phòng thủ: AT gửi số âm (bug/forge) → KHÔNG để cộng số âm vào pending/ví. DTO đã @Min(0)
    // nhưng handlePostback có thể được gọi nội bộ nên guard lại ở đây.
    if (payload.amount < 0 || payload.commission < 0) {
      this.logger.warn(`Postback amount/commission âm — bỏ qua. order=${payload.order_id}`);
      return { ok: false };
    }
    const click = await this.prisma.cashbackClick.findUnique({
      where: { utmTraceId: payload.utm_content },
    });
    if (!click) {
      this.logger.warn(`Postback không khớp clickId ${payload.utm_content}`);
      return { ok: false };
    }
    const userShare = await this.config.get<number>('cashback.merchant_user_share', 0.7);
    const userReward = Math.floor(payload.commission * userShare);
    const status = payload.status === 'approved' ? 'CONFIRMED' : payload.status === 'rejected' ? 'REJECTED' : 'PENDING';

    const existing = await this.prisma.cashbackTransaction.findFirst({
      where: { merchantOrderId: payload.order_id },
    });

    // becameConfirmed + ai → sau khi commit thì thưởng xu giới thiệu (referee có cashback đầu).
    let becameConfirmed = false;
    let confirmedUserId: string | null = null;

    if (existing) {
      // Đã settle về Ví (PAID) → BỎ QUA mọi postback đến sau: không ghi đè status (giữ dấu
      // đã trả tiền), không đụng số dư (không thể claw-back tiền đã về Ví).
      if (existing.status === 'PAID') return { ok: true };

      // Điều chỉnh cashbackPending theo CHUYỂN TRẠNG THÁI (PENDING→CONFIRMED cộng,
      // CONFIRMED→REJECTED trừ lại). CHUYỂN ATOMIC bằng optimistic CAS theo status đã đọc +
      // điều chỉnh pending trong CÙNG tx — chống 2 postback 'approved' song song trên cùng row
      // PENDING cùng cộng pending 2 lần (double-credit tiền thật). Racer thua thấy count=0 → bỏ qua.
      const wasConfirmed = existing.status === 'CONFIRMED';
      const nowConfirmed = status === 'CONFIRMED';
      const applied = await this.prisma.$transaction(async (tx) => {
        const moved = await tx.cashbackTransaction.updateMany({
          where: { id: existing.id, status: existing.status },
          data: {
            // confirmedAt set MỚI khi chuyển TỪ chưa-confirmed SANG confirmed (reset đồng hồ hold);
            // giữ nguyên khi đã confirmed. Tránh REJECTED→CONFIRMED giữ confirmedAt cũ → settle
            // ngay, né hết hold 30 ngày (clawback window).
            status,
            confirmedAt: nowConfirmed && !wasConfirmed ? new Date() : existing.confirmedAt,
          },
        });
        if (moved.count === 0) return false;
        if (nowConfirmed && !wasConfirmed) {
          await tx.user.update({
            where: { id: existing.userId },
            data: { cashbackPending: { increment: existing.userReward } },
          });
        } else if (wasConfirmed && !nowConfirmed) {
          await tx.user.update({
            where: { id: existing.userId },
            data: { cashbackPending: { decrement: existing.userReward } },
          });
        }
        return true;
      });
      if (applied && nowConfirmed && !wasConfirmed) {
        becameConfirmed = true;
        confirmedUserId = existing.userId;
      }
    } else {
      // Atomic create + cộng pending. merchantOrderId @unique → 2 postback song song thì
      // cái thứ 2 ném P2002 → bỏ qua để KHÔNG double-credit cashback.
      try {
        const ops: Prisma.PrismaPromise<unknown>[] = [
          this.prisma.cashbackTransaction.create({
            data: {
              userId: click.userId,
              clickId: click.id,
              merchantOrderId: payload.order_id,
              orderAmount: payload.amount,
              commission: payload.commission,
              userReward,
              status,
              postbackPayload: payload as object,
              confirmedAt: status === 'CONFIRMED' ? new Date() : null,
            },
          }),
        ];
        if (status === 'CONFIRMED') {
          ops.push(
            this.prisma.user.update({
              where: { id: click.userId },
              data: { cashbackPending: { increment: userReward } },
            }),
          );
          becameConfirmed = true;
          confirmedUserId = click.userId;
        }
        await this.prisma.$transaction(ops);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          this.logger.warn(`Postback trùng order_id ${payload.order_id} (race) — bỏ qua.`);
          return { ok: true };
        }
        throw err;
      }
    }

    // Thưởng xu giới thiệu khi referee có cashback CONFIRMED (ngoài tx tài chính để không phình
    // tx; idempotent qua unique index nên gọi nhiều lần vô hại). Lỗi thưởng KHÔNG được làm hỏng
    // postback (.catch) — nếu để throw, webhook trả 5xx → AT retry nhưng row đã CONFIRMED nên
    // becameConfirmed=false → không thưởng lại, lại còn báo lỗi cho AT dù tx tài chính đã commit.
    if (becameConfirmed && confirmedUserId) {
      await this.coins.grantReferralCoins(confirmedUserId).catch((err) =>
        this.logger.error(
          `Thưởng xu giới thiệu lỗi (referee=${confirmedUserId}): ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
    return { ok: true };
  }

  /** Cron mỗi giờ: cashback CONFIRMED quá hold_days → chuyển pending→Ví (PAID). */
  @Cron('0 30 * * * *')
  async settleConfirmed(): Promise<void> {
    const holdDays = await this.config.get<number>('cashback.hold_days', 30);
    const threshold = new Date(Date.now() - holdDays * 24 * 3600 * 1000);
    const due = await this.prisma.cashbackTransaction.findMany({
      where: { status: 'CONFIRMED', confirmedAt: { lte: threshold } },
    });
    for (const tx of due) {
      const settled = await this.prisma.$transaction(async (t) => {
        // Gate atomic: chỉ settle nếu vẫn CONFIRMED → multi-instance cron không
        // double-credit ví (instance thua cuộc thấy count=0 → bỏ qua).
        const marked = await t.cashbackTransaction.updateMany({
          where: { id: tx.id, status: 'CONFIRMED' },
          data: { status: 'PAID', paidAt: new Date() },
        });
        if (marked.count === 0) return false;
        await t.user.update({
          where: { id: tx.userId },
          data: {
            cashbackPending: { decrement: tx.userReward },
            walletBalance: { increment: tx.userReward },
          },
        });
        return true;
      });
      // Thông báo tiền đã về Ví (side-effect — lỗi gửi KHÔNG làm hỏng settle/cron).
      if (settled) {
        await this.notifications
          .notify(tx.userId, 'CASHBACK_PAID', { amount: tx.userReward.toLocaleString('vi-VN') })
          .catch((err) => this.logger.error(`Notify CASHBACK_PAID lỗi: ${err instanceof Error ? err.message : err}`));
      }
    }
    if (due.length > 0) this.logger.log(`Settle ${due.length} cashback → Ví Tubu.`);
  }

  private buildDeeplink(template: string, clickId: string, productUrl?: string): string {
    let url = template.replace('{{clickId}}', clickId);
    if (productUrl) url += `&url=${encodeURIComponent(productUrl)}`;
    return url;
  }
}
