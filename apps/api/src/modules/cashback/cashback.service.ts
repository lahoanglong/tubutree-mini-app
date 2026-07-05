import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { CoinsService } from '../wallet/coins.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CashbackProviderRegistry } from './providers/cashback-provider.registry';
import type { NormalizedCashbackEvent } from './providers/cashback-provider.interface';

/**
 * Cashback sàn ngoài (Build Spec §9, §15 cashback.*). Provider-agnostic: I/O vendor nằm ở
 * CashbackProvider; lõi này chỉ xử lý NormalizedCashbackEvent. Tubu giữ margin, user nhận
 * `merchant_user_share` (mặc định 70%). Hold `cashback.hold_days` sau confirm rồi mới về Ví.
 */
@Injectable()
export class CashbackService {
  private readonly logger = new Logger(CashbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly coins: CoinsService,
    private readonly notifications: NotificationsService,
    private readonly registry: CashbackProviderRegistry,
  ) {}

  listMerchants() {
    return this.prisma.cashbackMerchant.findMany({ where: { isActive: true } });
  }

  /** Tạo click + sinh deeplink chứa clickId theo provider của merchant. */
  async createClick(userId: string, merchantId: string, productUrl?: string) {
    const merchant = await this.prisma.cashbackMerchant.findUnique({ where: { id: merchantId } });
    if (!merchant || !merchant.isActive) throw new BadRequestException('Sàn không khả dụng.');
    const provider = this.registry.get(merchant.provider);

    const rateLimit = await this.config.get<number>('cashback.click_rate_limit_seconds', 30);
    const recent = await this.prisma.cashbackClick.findFirst({
      where: { userId, merchantId, clickedAt: { gte: new Date(Date.now() - rateLimit * 1000) } },
    });
    if (recent) {
      return { deeplink: provider.buildDeeplink(merchant.deeplinkTemplate, recent.utmTraceId, productUrl) };
    }

    const clickId = randomUUID().replace(/-/g, '');
    const deeplink = provider.buildDeeplink(merchant.deeplinkTemplate, clickId, productUrl);
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

  /**
   * Nạp một sự kiện cashback đã chuẩn hoá (từ webhook HOẶC reconcile). Idempotent theo
   * (provider, merchantOrderId). Dùng chung cho mọi provider.
   */
  async ingest(event: NormalizedCashbackEvent, provider: string) {
    // Phòng thủ: parseWebhook đã guard, nhưng reconcile cũng gọi vào đây → guard lại.
    if (event.orderAmount < 0 || event.commission < 0) {
      this.logger.warn(`Ingest số âm — bỏ qua. order=${event.merchantOrderId}`);
      return { ok: false };
    }
    const click = await this.prisma.cashbackClick.findUnique({ where: { utmTraceId: event.clickRef } });
    if (!click) {
      this.logger.warn(`Ingest không khớp clickId ${event.clickRef}`);
      return { ok: false };
    }
    const userShare = await this.config.get<number>('cashback.merchant_user_share', 0.7);
    const userReward = Math.floor(event.commission * userShare);
    const status = event.status;

    const existing = await this.prisma.cashbackTransaction.findFirst({
      where: { provider, merchantOrderId: event.merchantOrderId },
    });

    let becameConfirmed = false;
    let confirmedUserId: string | null = null;

    if (existing) {
      // Đã settle về Ví (PAID) → BỎ QUA postback đến sau: không ghi đè status, không đụng số dư
      // (không claw-back được tiền đã về Ví).
      if (existing.status === 'PAID') return { ok: true };

      // Chuyển trạng thái ATOMIC bằng optimistic CAS theo status đã đọc + điều chỉnh pending trong
      // CÙNG tx → chống 2 sự kiện 'approved' song song cùng cộng pending 2 lần. Racer thua thấy
      // count=0 → bỏ qua.
      const wasConfirmed = existing.status === 'CONFIRMED';
      const nowConfirmed = status === 'CONFIRMED';
      const applied = await this.prisma.$transaction(async (tx) => {
        const moved = await tx.cashbackTransaction.updateMany({
          where: { id: existing.id, status: existing.status },
          data: {
            // confirmedAt set MỚI khi chuyển từ chưa-confirmed sang confirmed (reset đồng hồ hold);
            // giữ nguyên khi đã confirmed. Tránh REJECTED→CONFIRMED giữ confirmedAt cũ → settle ngay.
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
      // Atomic create + cộng pending. @@unique([provider, merchantOrderId]) → sự kiện thứ 2 song
      // song ném P2002 → bỏ qua để KHÔNG double-credit.
      try {
        const ops: Prisma.PrismaPromise<unknown>[] = [
          this.prisma.cashbackTransaction.create({
            data: {
              userId: click.userId,
              clickId: click.id,
              provider,
              merchantOrderId: event.merchantOrderId,
              orderAmount: event.orderAmount,
              commission: event.commission,
              userReward,
              status,
              postbackPayload: event.raw as object,
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
          this.logger.warn(`Ingest trùng (${provider}, ${event.merchantOrderId}) (race) — bỏ qua.`);
          return { ok: true };
        }
        throw err;
      }
    }

    // Thưởng xu giới thiệu khi referee có cashback CONFIRMED (ngoài tx tài chính; idempotent qua
    // unique index). Lỗi thưởng KHÔNG làm hỏng ingest (.catch).
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
      if (settled) {
        await this.notifications
          .notify(tx.userId, 'CASHBACK_PAID', { amount: tx.userReward.toLocaleString('vi-VN') })
          .catch((err) => this.logger.error(`Notify CASHBACK_PAID lỗi: ${err instanceof Error ? err.message : err}`));
      }
    }
    if (due.length > 0) this.logger.log(`Settle ${due.length} cashback → Ví Tubu.`);
  }

  /**
   * Cron mỗi 6 giờ: đối soát — kéo giao dịch gần đây từ mỗi provider có bật reconcile
   * (isReconcileEnabled) rồi feed qua ingest() (idempotent). Bắt postback rớt.
   */
  @Cron('0 0 */6 * * *')
  async reconcile(): Promise<void> {
    const lookbackDays = await this.config.get<number>('cashback.reconcile_lookback_days', 45);
    const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
    for (const provider of this.registry.all()) {
      if (!provider.isReconcileEnabled()) {
        this.logger.debug(`Reconcile skip ${provider.key} (chưa cấu hình).`);
        continue;
      }
      try {
        const events = await provider.fetchTransactions(since);
        for (const e of events) await this.ingest(e, provider.key);
        if (events.length) this.logger.log(`Reconcile ${provider.key}: ${events.length} giao dịch.`);
      } catch (err) {
        this.logger.error(`Reconcile ${provider.key} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
