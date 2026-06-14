import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

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
    if (existing) {
      // Điều chỉnh cashbackPending theo CHUYỂN TRẠNG THÁI (trước đây chỉ cộng ở nhánh
      // create → postback PENDING rồi APPROVED sẽ không bao giờ cộng pending; và
      // CONFIRMED→REJECTED không trừ lại). Không đụng nếu đã PAID (đã về Ví).
      const wasConfirmed = existing.status === 'CONFIRMED';
      const nowConfirmed = status === 'CONFIRMED';
      const ops: ReturnType<typeof this.prisma.cashbackTransaction.update>[] = [
        this.prisma.cashbackTransaction.update({
          where: { id: existing.id },
          data: { status, confirmedAt: nowConfirmed ? (existing.confirmedAt ?? new Date()) : existing.confirmedAt },
        }),
      ];
      if (existing.status !== 'PAID') {
        if (nowConfirmed && !wasConfirmed) {
          ops.push(
            this.prisma.user.update({
              where: { id: existing.userId },
              data: { cashbackPending: { increment: existing.userReward } },
            }) as never,
          );
        } else if (wasConfirmed && !nowConfirmed) {
          ops.push(
            this.prisma.user.update({
              where: { id: existing.userId },
              data: { cashbackPending: { decrement: existing.userReward } },
            }) as never,
          );
        }
      }
      await this.prisma.$transaction(ops);
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
      await this.prisma.$transaction(async (t) => {
        // Gate atomic: chỉ settle nếu vẫn CONFIRMED → multi-instance cron không
        // double-credit ví (instance thua cuộc thấy count=0 → bỏ qua).
        const marked = await t.cashbackTransaction.updateMany({
          where: { id: tx.id, status: 'CONFIRMED' },
          data: { status: 'PAID', paidAt: new Date() },
        });
        if (marked.count === 0) return;
        await t.user.update({
          where: { id: tx.userId },
          data: {
            cashbackPending: { decrement: tx.userReward },
            walletBalance: { increment: tx.userReward },
          },
        });
      });
    }
    if (due.length > 0) this.logger.log(`Settle ${due.length} cashback → Ví Tubu.`);
  }

  private buildDeeplink(template: string, clickId: string, productUrl?: string): string {
    let url = template.replace('{{clickId}}', clickId);
    if (productUrl) url += `&url=${encodeURIComponent(productUrl)}`;
    return url;
  }
}
