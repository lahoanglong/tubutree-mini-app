import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CashbackStatus, Prisma } from '@prisma/client';
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
  /** Trần mỗi lượt settle — phần còn lại để lượt cron kế (chạy 30 phút/lần). */
  private static readonly SETTLE_BATCH = 500;

  private readonly logger = new Logger(CashbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly coins: CoinsService,
    private readonly notifications: NotificationsService,
    private readonly registry: CashbackProviderRegistry,
  ) {}

  /**
   * Endpoint này là @Public. Trả nguyên bản ghi sẽ lộ `deeplinkTemplate` (link affiliate thật
   * của Tubu, ai cũng dùng lại được), `provider` và `fullRate` — từ chênh lệch fullRate với
   * baseRate suy ra ngay phần Tubu giữ lại. FE chỉ dùng đúng các trường dưới đây.
   */
  listMerchants() {
    return this.prisma.cashbackMerchant.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, logoUrl: true, category: true, baseRate: true, terms: true },
    });
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
      // nulls: 'last' — không có createdAt trên model; mặc định Postgres DESC đặt NULL
      // (giao dịch PENDING chưa confirm) lên ĐẦU, đẩy giao dịch mới CONFIRMED xuống dưới.
      orderBy: { confirmedAt: { sort: 'desc', nulls: 'last' } },
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

    let result: { becameConfirmed: boolean; confirmedUserId: string | null };
    if (existing) {
      result = await this.applyToExisting(existing, event, status, userReward);
    } else {
      // Atomic create + cộng pending. @@unique([provider, merchantOrderId]) → sự kiện thứ 2 song
      // song ném P2002.
      try {
        result = await this.createTransaction(click, provider, event, status, userReward);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Kẻ thua race: KHÔNG bỏ qua sự kiện (sẽ mất credit nếu event này là CONFIRMED) — đọc
          // lại giao dịch mà kẻ thắng vừa tạo (đã commit, vì P2002 chỉ xảy ra SAU khi transaction
          // kia commit) rồi áp dụng transition y hệt nhánh "existing" (idempotent, CAS theo status
          // chống cộng pending 2 lần).
          const winner = await this.prisma.cashbackTransaction.findFirst({
            where: { provider, merchantOrderId: event.merchantOrderId },
          });
          if (!winner) {
            this.logger.error(
              `Ingest P2002 (${provider}, ${event.merchantOrderId}) nhưng không đọc lại được giao dịch — bỏ qua.`,
            );
            return { ok: false };
          }
          this.logger.warn(`Ingest trùng (${provider}, ${event.merchantOrderId}) (race) — áp dụng như update.`);
          result = await this.applyToExisting(winner, event, status, userReward);
        } else {
          throw err;
        }
      }
    }

    // Thưởng xu giới thiệu khi referee có cashback CONFIRMED (ngoài tx tài chính; idempotent qua
    // unique index). Lỗi thưởng KHÔNG làm hỏng ingest (.catch).
    if (result.becameConfirmed && result.confirmedUserId) {
      await this.coins.grantReferralCoins(result.confirmedUserId).catch((err) =>
        this.logger.error(
          `Thưởng xu giới thiệu lỗi (referee=${result.confirmedUserId}): ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
    return { ok: true };
  }

  // ── Quản trị ────────────────────────────────────────────────────────────────────────────
  /**
   * Danh sách giao dịch cashback cho admin, kèm sàn và khách.
   *
   * Trước đây KHÔNG có đường quản trị nào cho cashback: trạng thái chỉ đổi qua postback của
   * provider, mà reconcile lại tắt khi chưa có API key. Postback rớt mạng hoặc sàn chỉ đổi
   * trạng thái qua API report là giao dịch nằm PENDING vĩnh viễn — khách thấy "Chờ duyệt" vô
   * thời hạn và không ai xử lý được.
   */
  async adminListTransactions(status?: string, take = 100) {
    const rows = await this.prisma.cashbackTransaction.findMany({
      where: status ? { status: status as CashbackStatus } : {},
      orderBy: { confirmedAt: { sort: 'desc', nulls: 'first' } },
      take: Math.min(Math.max(take, 1), 200),
      select: {
        id: true,
        userId: true,
        provider: true,
        merchantOrderId: true,
        orderAmount: true,
        commission: true,
        userReward: true,
        status: true,
        confirmedAt: true,
        paidAt: true,
        clickId: true,
      },
    });
    if (rows.length === 0) return [];
    // CashbackTransaction chỉ lưu clickId dạng chuỗi (schema không khai quan hệ) nên nạp theo
    // lô rồi ghép — 3 truy vấn cho cả trang, không phải N+1.
    const clickIds = [...new Set(rows.map((r) => r.clickId).filter((id): id is string => !!id))];
    const [users, clicks] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, fullName: true, phone: true },
      }),
      clickIds.length
        ? this.prisma.cashbackClick.findMany({
            where: { id: { in: clickIds } },
            select: { id: true, merchant: { select: { name: true, slug: true } } },
          })
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const clickMap = new Map(clicks.map((c) => [c.id, c.merchant]));
    return rows.map((r) => ({
      ...r,
      user: userMap.get(r.userId) ?? null,
      merchant: r.clickId ? (clickMap.get(r.clickId) ?? null) : null,
    }));
  }

  /**
   * Admin duyệt/từ chối một giao dịch cashback đang treo. Dùng LẠI đúng bộ chuyển trạng thái
   * của postback (CAS theo status + điều chỉnh cashbackPending trong cùng transaction) nên
   * không có đường tính tiền thứ hai để lệch nhau.
   *
   * Không đụng tới giao dịch đã PAID: tiền đã về Ví, không claw-back được.
   */
  async adminReview(adminId: string, id: string, status: 'CONFIRMED' | 'REJECTED', note?: string) {
    const existing = await this.prisma.cashbackTransaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Không tìm thấy giao dịch cashback.');
    if (existing.status === 'PAID') {
      throw new BadRequestException('Giao dịch đã trả về Ví — không đổi được trạng thái.');
    }
    if (existing.status === status) {
      throw new BadRequestException('Giao dịch đã ở trạng thái này.');
    }
    // Sự kiện tổng hợp: giữ nguyên số tiền đã ghi để admin duyệt KHÔNG vô tình định giá lại.
    const synthetic: NormalizedCashbackEvent = {
      clickRef: '',
      merchantOrderId: existing.merchantOrderId,
      orderAmount: existing.orderAmount,
      commission: existing.commission,
      status,
      raw: { adminReview: { adminId, note: note ?? null, at: new Date().toISOString() } },
    };
    await this.applyToExisting(existing, synthetic, status, existing.userReward);
    this.logger.warn(
      `Admin ${adminId} đặt cashback ${existing.merchantOrderId} (${existing.provider}): ${existing.status} → ${status}${note ? ` — ${note}` : ''}`,
    );
    return this.prisma.cashbackTransaction.findUnique({ where: { id } });
  }

  /** Chuyển trạng thái 1 giao dịch cashback đã tồn tại theo sự kiện mới (idempotent, atomic). */
  private async applyToExisting(
    existing: { id: string; userId: string; status: CashbackStatus; confirmedAt: Date | null; userReward: number },
    event: NormalizedCashbackEvent,
    status: NormalizedCashbackEvent['status'],
    userReward: number,
  ): Promise<{ becameConfirmed: boolean; confirmedUserId: string | null }> {
    // Đã settle về Ví (PAID) → BỎ QUA postback đến sau: không ghi đè status, không đụng số dư
    // (không claw-back được tiền đã về Ví).
    if (existing.status === 'PAID') return { becameConfirmed: false, confirmedUserId: null };

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
          // Postback sau có thể sửa số tiền (VD PENDING gửi tạm tính rồi CONFIRMED gửi số cuối
          // cùng chính xác hơn) — chỉ ghi đè khi CHƯA từng confirm (chưa cộng cashbackPending
          // theo số cũ); đã confirm rồi thì giữ nguyên để tránh lệch sổ cashbackPending/Ví.
          ...(wasConfirmed
            ? {}
            : { orderAmount: event.orderAmount, commission: event.commission, userReward }),
        },
      });
      if (moved.count === 0) return false;
      if (nowConfirmed && !wasConfirmed) {
        await tx.user.update({
          where: { id: existing.userId },
          data: { cashbackPending: { increment: userReward } },
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
      return { becameConfirmed: true, confirmedUserId: existing.userId };
    }
    return { becameConfirmed: false, confirmedUserId: null };
  }

  /** Tạo mới 1 giao dịch cashback từ sự kiện đầu tiên nhận được cho (provider, merchantOrderId). */
  private async createTransaction(
    click: { id: string; userId: string },
    provider: string,
    event: NormalizedCashbackEvent,
    status: NormalizedCashbackEvent['status'],
    userReward: number,
  ): Promise<{ becameConfirmed: boolean; confirmedUserId: string | null }> {
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
    let becameConfirmed = false;
    let confirmedUserId: string | null = null;
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
    return { becameConfirmed, confirmedUserId };
  }

  /** Cron mỗi giờ: cashback CONFIRMED quá hold_days → chuyển pending→Ví (PAID). */
  @Cron('0 30 * * * *')
  async settleConfirmed(): Promise<void> {
    const holdDays = await this.config.get<number>('cashback.hold_days', 30);
    const threshold = new Date(Date.now() - holdDays * 24 * 3600 * 1000);
    // `take` + `select`: bản ghi có cột postbackPayload là JSON nguyên văn của provider. Nạp
    // KHÔNG giới hạn cả payload vào RAM là rủi ro thật khi bật đối soát với cửa sổ 45 ngày —
    // hàng chục nghìn giao dịch qua mốc hold cùng lúc, và vì đây là bước ĐẦU TIÊN nên OOM ở đây
    // là không giao dịch nào được settle.
    const due = await this.prisma.cashbackTransaction.findMany({
      where: { status: 'CONFIRMED', confirmedAt: { lte: threshold } },
      select: { id: true, userId: true, userReward: true },
      orderBy: { id: 'asc' },
      take: CashbackService.SETTLE_BATCH,
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
        // Cô lập lỗi TỪNG sự kiện: ingest re-throw mọi lỗi không phải P2002, nên trước đây một
        // event hỏng cố định ở vị trí thứ 3/500 chặn luôn 497 event sau — lặp lại y hệt mỗi 6
        // giờ, và dấu vết duy nhất là một dòng log. Tiền hoàn của khách âm thầm ngừng chảy.
        let failed = 0;
        for (const e of events) {
          try {
            await this.ingest(e, provider.key);
          } catch (err) {
            failed++;
            this.logger.error(
              `Reconcile ${provider.key} — đơn ${e.merchantOrderId} lỗi: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
        if (events.length) {
          this.logger.log(
            `Reconcile ${provider.key}: ${events.length} giao dịch${failed ? ` (${failed} lỗi, đã bỏ qua)` : ''}.`,
          );
        }
      } catch (err) {
        this.logger.error(`Reconcile ${provider.key} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
