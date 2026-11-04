import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CashbackStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { creditWalletUnlessAnonymized } from '../wallet/wallet-anonymized-guard';
import { CashbackProviderRegistry } from './providers/cashback-provider.registry';
import type { NormalizedCashbackEvent } from './providers/cashback-provider.interface';
import { CRON_TZ } from '../../common/cron-tz';
import { maskPhoneKeepLast3 } from '../../common/mask-pii';
import { TrackCron } from '../../common/cron-run/track-cron';
import { isRealUser } from '../../common/real-user';
import { notifyAdmins } from '../../common/notify-admins';
import { productUrlMatchesMerchant } from './cashback-hosts';

/**
 * Cashback sàn ngoài (Build Spec §9, §15 cashback.*). Provider-agnostic: I/O vendor nằm ở
 * CashbackProvider; lõi này chỉ xử lý NormalizedCashbackEvent. Tubu giữ margin, user nhận
 * `merchant_user_share` (mặc định 70%). Hold `cashback.hold_days` sau confirm rồi mới về Ví.
 */
/** Kế toán duyệt theo tên/mã đơn sàn, không cần SĐT đầy đủ của khách. */
function maskedUser<U extends { phone: string | null }>(user: U | undefined, mask?: boolean): U | null {
  if (!user) return null;
  return mask && user.phone ? { ...user, phone: maskPhoneKeepLast3(user.phone) } : user;
}

type ExistingCashbackRow = {
  id: string;
  userId: string;
  status: CashbackStatus;
  confirmedAt: Date | null;
  userReward: number;
  adminReviewedAt?: Date | null;
  merchantOrderId?: string;
  provider?: string;
};

type ConflictNotice = {
  row: ExistingCashbackRow;
  kind: 'PAID_REJECTED' | 'ADMIN_OVERRIDE' | 'REVIVED';
  /** Số tiền đưa vào tin báo; REVIVED phải in số vừa cộng vào pending (có thể khác số cũ trên dòng). */
  reward?: number;
  /** Trạng thái của dòng lúc phát hiện: claim dấu chỉ thắng khi dòng còn ở trạng thái đó (settle chen giữa thì chặng mới tự báo). */
  atStatus: CashbackStatus;
};

const STATUS_VI: Record<CashbackStatus, string> = {
  PENDING: 'Chờ duyệt',
  CONFIRMED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  PAID: 'Đã trả về Ví',
};

@Injectable()
export class CashbackService {
  /** Trần mỗi lượt settle — phần còn lại để lượt cron kế (chạy 30 phút/lần). */
  private static readonly SETTLE_BATCH = 500;

  /**
   * Trạng thái đang có mà sự kiện của sàn được phép chuyển đi. Chỉ chặn kéo LÙI về PENDING (và PENDING lên PENDING thì chỉ cập nhật số tiền).
   * REJECTED ↔ CONFIRMED vẫn cho đi cả hai chiều vì sàn có quyền duyệt lại hoặc huỷ sau duyệt; chiều REJECTED → CONFIRMED được báo ADMIN.
   */
  private static readonly FORWARD_FROM: Record<NormalizedCashbackEvent['status'], CashbackStatus[]> = {
    PENDING: ['PENDING'],
    CONFIRMED: ['PENDING', 'REJECTED'],
    REJECTED: ['PENDING', 'CONFIRMED'],
  };

  private static readonly CAS_ATTEMPTS = 3;

  private readonly logger = new Logger(CashbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
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
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, zaloId: true } });
    if (!isRealUser(user)) throw new BadRequestException('Đăng nhập Zalo để nhận hoàn tiền mua sắm.');
    const merchant = await this.prisma.cashbackMerchant.findUnique({ where: { id: merchantId } });
    if (!merchant || !merchant.isActive) throw new BadRequestException('Sàn không khả dụng.');
    if (productUrl && !productUrlMatchesMerchant(merchant.slug, productUrl)) {
      throw new BadRequestException(`Link sản phẩm phải thuộc sàn ${merchant.name}.`);
    }
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
    let lost = false;

    if (existing) {
      // Trạng thái lạ của sàn không có ý nghĩa với dòng đã có (không có gì để chuyển).
      if (event.unknownStatus === undefined && (await this.applyToExisting(existing, event, status, userReward)) === 'lost') lost = true;
    } else {
      // Atomic create + cộng pending. @@unique([provider, merchantOrderId]) → sự kiện thứ 2 song
      // song ném P2002.
      try {
        await this.createTransaction(click, provider, event, status, userReward);
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
          if (event.unknownStatus === undefined && (await this.applyToExisting(winner, event, status, userReward)) === 'lost') lost = true;
        } else {
          throw err;
        }
      }
    }

    // Thua CAS mãi (đã log error): báo cho webhook trả lỗi tạm để sàn gửi lại, thay vì ok:true làm mất sự kiện.
    return lost ? { ok: false, retry: true } : { ok: true };
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
  async adminListTransactions(status?: string, take = 100, opts: { maskPhones?: boolean } = {}) {
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
        adminReviewedAt: true,
        conflictNotifiedAt: true,
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
      user: maskedUser(userMap.get(r.userId), opts.maskPhones),
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
  async adminReview(adminId: string, id: string, status: 'CONFIRMED' | 'REJECTED', note?: string, opts: { byStaff?: boolean } = {}) {
    const existing = await this.prisma.cashbackTransaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Không tìm thấy giao dịch cashback.');
    if (opts.byStaff && existing.userId === adminId) {
      throw new ForbiddenException('Không duyệt hoàn tiền của chính mình — nhờ quản trị viên.');
    }
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
    const outcome = await this.applyToExisting(existing, synthetic, status, existing.userReward, { manual: true, reviewedBy: adminId });
    // CAS thua: người khác (tab khác, postback, cron settle) đã đổi dòng này giữa lúc ta đọc và ghi. Không log như đã đổi.
    if (outcome !== 'moved') throw new ConflictException('Khoản này vừa được người khác xử lý — tải lại.');
    this.logger.warn(
      `${opts.byStaff ? 'Kế toán' : 'Admin'} ${adminId} đặt cashback ${existing.merchantOrderId} (${existing.provider}): ${existing.status} → ${status}${note ? ` — ${note}` : ''}`,
    );
    return this.prisma.cashbackTransaction.findUnique({ where: { id } });
  }

  /** Chuyển trạng thái 1 giao dịch cashback đã tồn tại theo sự kiện mới (idempotent, atomic). */
  private async applyToExisting(
    existing: ExistingCashbackRow,
    event: NormalizedCashbackEvent,
    status: NormalizedCashbackEvent['status'],
    userReward: number,
    opts: { manual?: boolean; reviewedBy?: string } = {},
  ): Promise<'moved' | 'skipped' | 'lost'> {
    // Chuyển trạng thái ATOMIC bằng optimistic CAS + điều chỉnh pending trong CÙNG tx → chống 2 sự kiện song song cùng cộng
    // pending 2 lần. CAS khớp cả userReward: số trừ khỏi cashbackPending phải là số đang nằm trên dòng lúc CAS, không phải số
    // đọc ngoài tx từ trước (một sự kiện khác có thể đã sửa số tiền giữa chừng). Thua CAS thì đọc lại dòng trong tx rồi quyết định lại.
    let conflict: ConflictNotice | null = null;
    const outcome = await this.prisma.$transaction(async (tx): Promise<'moved' | 'skipped' | 'lost'> => {
      let cur = existing;
      for (let attempt = 0; attempt < CashbackService.CAS_ATTEMPTS; attempt++) {
        // Đã settle về Ví (PAID) → BỎ QUA postback đến sau: không ghi đè status, không đụng số dư (không claw-back được tiền đã về Ví).
        // Riêng "rejected" sau PAID là việc kế toán phải biết: sàn đòi lại hoa hồng nhưng tiền khách đã về Ví.
        if (cur.status === 'PAID') {
          if (!opts.manual && status === 'REJECTED') conflict = { row: cur, kind: 'PAID_REJECTED', atStatus: 'PAID' };
          return 'skipped';
        }
        // Dòng đã có quyết định tay của Kế toán: sàn báo khác thì giữ nguyên quyết định, chỉ báo ADMIN (PENDING là sàn chưa có ý kiến, không báo).
        if (!opts.manual && cur.adminReviewedAt) {
          if (status !== cur.status && status !== 'PENDING') conflict = { row: cur, kind: 'ADMIN_OVERRIDE', atStatus: cur.status };
          return 'skipped';
        }
        // Sự kiện đến muộn hoặc sai thứ tự (postback PENDING sau khi reconcile đã CONFIRMED) không được kéo trạng thái lùi: lùi về
        // PENDING thì khoản đó không bao giờ settle về Ví. Admin duyệt tay là quyết định tường minh nên được đi mọi hướng.
        if (!opts.manual && !CashbackService.FORWARD_FROM[status].includes(cur.status)) return 'skipped';
        const wasConfirmed = cur.status === 'CONFIRMED';
        const nowConfirmed = status === 'CONFIRMED';
        const moved = await tx.cashbackTransaction.updateMany({
          where: { id: cur.id, status: cur.status, userReward: cur.userReward, ...(opts.manual ? {} : { adminReviewedAt: null }) },
          data: {
            ...(opts.manual
              ? { adminReviewedAt: new Date(), adminReviewedBy: opts.reviewedBy ?? null, conflictNotifiedAt: null, conflictPayload: Prisma.DbNull }
              : {}),
            // Sàn đưa dòng đã CONFIRMED về REJECTED: hết chặng "đã duyệt lại", lần sàn hồi sinh sau (REVIVED) phải báo lại được.
            ...(!opts.manual && wasConfirmed && !nowConfirmed ? { conflictNotifiedAt: null } : {}),
            // confirmedAt set MỚI khi chuyển từ chưa-confirmed sang confirmed (reset đồng hồ hold);
            // giữ nguyên khi đã confirmed. Tránh REJECTED→CONFIRMED giữ confirmedAt cũ → settle ngay.
            status,
            confirmedAt: nowConfirmed && !wasConfirmed ? new Date() : cur.confirmedAt,
            // Postback sau có thể sửa số tiền (VD PENDING gửi tạm tính rồi CONFIRMED gửi số cuối
            // cùng chính xác hơn) — chỉ ghi đè khi CHƯA từng confirm (chưa cộng cashbackPending
            // theo số cũ); đã confirm rồi thì giữ nguyên để tránh lệch sổ cashbackPending/Ví.
            ...(wasConfirmed ? {} : { orderAmount: event.orderAmount, commission: event.commission, userReward }),
          },
        });
        if (moved.count > 0) {
          if (nowConfirmed && !wasConfirmed) {
            await tx.user.update({ where: { id: cur.userId }, data: { cashbackPending: { increment: userReward } } });
            // Sàn lật khoản đã bị từ chối thành duyệt khi chưa có quyết định tay: tiền sẽ về Ví sau thời gian giữ, ADMIN cần biết.
            if (!opts.manual && cur.status === 'REJECTED') conflict = { row: cur, kind: 'REVIVED', reward: userReward, atStatus: 'CONFIRMED' };
          } else if (wasConfirmed && !nowConfirmed) {
            await tx.user.update({ where: { id: cur.userId }, data: { cashbackPending: { decrement: cur.userReward } } });
          }
          return 'moved';
        }
        if (opts.manual) return 'lost';
        const fresh = await tx.cashbackTransaction.findUnique({
          where: { id: cur.id },
          select: { id: true, userId: true, status: true, confirmedAt: true, userReward: true, adminReviewedAt: true, merchantOrderId: true, provider: true },
        });
        if (!fresh) return 'skipped';
        cur = fresh;
      }
      this.logger.error(
        `Cashback ${cur.merchantOrderId ?? event.merchantOrderId}: thua CAS ${CashbackService.CAS_ATTEMPTS} lần liên tiếp, bỏ sự kiện ${event.status} (provider ${cur.provider ?? '?'}).`,
      );
      return 'lost';
    });
    if (conflict) await this.reportConflict(conflict, event);
    return outcome;
  }

  /** Báo ADMIN một lần mỗi dòng (CAS trên conflictNotifiedAt) khi sàn báo khác quyết định tay, đòi lại khoản đã trả hoặc lật khoản đã từ chối. Không ném. */
  private async reportConflict({ row, kind, reward, atStatus }: ConflictNotice, event: NormalizedCashbackEvent): Promise<void> {
    try {
      const claimed = await this.prisma.cashbackTransaction.updateMany({
        where: { id: row.id, conflictNotifiedAt: null, status: atStatus },
        data: { conflictNotifiedAt: new Date(), conflictPayload: (event.raw ?? {}) as Prisma.InputJsonValue },
      });
      if (claimed.count === 0) return;
      const order = row.merchantOrderId ?? event.merchantOrderId;
      const summary =
        kind === 'REVIVED'
          ? `Đơn ${order} (${row.provider ?? 'sàn'}): sàn duyệt lại khoản đã "Từ chối", cashback chờ về Ví ${(reward ?? row.userReward).toLocaleString('vi-VN')}đ đã được cộng lại. Kế toán kiểm tra nếu không đúng.`
          : kind === 'PAID_REJECTED'
          ? `Đơn ${order} (${row.provider ?? 'sàn'}): sàn báo "Từ chối" nhưng khoản hoàn ${row.userReward.toLocaleString('vi-VN')}đ đã trả về Ví khách. Tiền không đổi, kế toán đối chiếu với sàn.`
          : `Đơn ${order} (${row.provider ?? 'sàn'}): Kế toán đã đặt "${STATUS_VI[row.status]}", sàn báo "${STATUS_VI[event.status]}". Giữ quyết định của Kế toán, số dư không đổi.`;
      this.logger.warn(`Cashback ${row.id}: ${summary}`);
      await notifyAdmins(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        { template: 'OPS_HEALTH_ALERT', subject: `hoàn tiền sàn ${order} lệch`, data: () => ({ title: 'Hoàn tiền sàn ngoài báo khác quyết định', summary }) },
      );
    } catch (err) {
      this.logger.error(`Báo lệch cashback ${row.id} lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Tạo mới 1 giao dịch cashback từ sự kiện đầu tiên nhận được cho (provider, merchantOrderId). */
  private async createTransaction(
    click: { id: string; userId: string },
    provider: string,
    event: NormalizedCashbackEvent,
    status: NormalizedCashbackEvent['status'],
    userReward: number,
  ): Promise<void> {
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
    }
    await this.prisma.$transaction(ops);
  }

  /** Cron mỗi giờ: cashback CONFIRMED quá hold_days → chuyển pending→Ví (PAID). */
  @Cron('0 30 * * * *', { timeZone: CRON_TZ })
  @TrackCron()
  async settleConfirmed(): Promise<void> {
    try {
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
        const { outcome: settled, reward } = await this.prisma.$transaction(async (t) => {
          const marked = await t.cashbackTransaction.updateMany({
            where: { id: tx.id, status: 'CONFIRMED', confirmedAt: { lte: threshold } },
            // Dấu "đã báo lệch" theo từng chặng của dòng: sang PAID là chặng mới, sàn đòi lại sau đó (L2-08) phải báo được dù chặng trước đã báo.
            data: { status: 'PAID', paidAt: new Date(), conflictNotifiedAt: null },
          });
          if (marked.count === 0) return { outcome: 'none' as const, reward: 0 };
          // Dòng đã bị CAS khoá: số userReward đọc trước vòng lặp có thể đã đổi (REJECT rồi CONFIRMED lại với số mới).
          const { userReward } = await t.cashbackTransaction.findUniqueOrThrow({ where: { id: tx.id }, select: { userReward: true } });
          await t.user.update({
            where: { id: tx.userId },
            data: { cashbackPending: { decrement: userReward } },
          });
          let credited = userReward > 0;
          if (userReward > 0) {
            const res = await creditWalletUnlessAnonymized(t, {
              userId: tx.userId,
              delta: userReward,
              type: 'CASHBACK',
              refType: 'CASHBACK',
              refId: tx.id,
              reason: 'Cashback hết thời gian giữ',
            });
            // Tài khoản đã xoá thì khách đã đồng ý bỏ số dư Ví khi xoá; cashback chốt PAID mà không cộng để cron không quét lại mãi.
            if (!res.credited) {
              credited = false;
              this.logger.error(
                `Cashback ${tx.id} ${userReward}đ: tài khoản ${tx.userId} đã ẩn danh từ ${res.anonymizedAt}, KHÔNG cộng Ví, kế toán xử lý tay.`,
              );
            }
          }
          return { outcome: credited ? ('credited' as const) : ('skipped' as const), reward: userReward };
        });
        // Không có tiền vào Ví thì không báo "Hoàn tiền 0đ".
        if (settled === 'credited') {
          await this.notifications
            .notify(tx.userId, 'CASHBACK_PAID', { amount: reward.toLocaleString('vi-VN') })
            .catch((err) => this.logger.error(`Notify CASHBACK_PAID lỗi: ${err instanceof Error ? err.message : err}`));
        }
      }
      if (due.length > 0) this.logger.log(`Settle ${due.length} cashback → Ví Tubu.`);
    } catch (err) {
      this.logger.error(err);
    }
  }

  /**
   * Cron mỗi 6 giờ: đối soát — kéo giao dịch gần đây từ mỗi provider có bật reconcile
   * (isReconcileEnabled) rồi feed qua ingest() (idempotent). Bắt postback rớt.
   */
  @Cron('0 0 */6 * * *', { timeZone: CRON_TZ })
  @TrackCron()
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
