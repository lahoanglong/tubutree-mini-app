      // Phân trang keyset theo userId, không dùng LIMIT cố định: LIMIT không ORDER BY lấy lại đúng nhóm đầu mỗi lượt nên khách
      // ngoài nhóm đó không bao giờ được xét. HAVING loại người dưới mốc thấp nhất ngay trong SQL để trang không bị chiếm bởi
      // khách không đủ điều kiện; kết quả cấp không đổi vì chỉ có hit khi spent >= mốc thấp nhất.
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CRON_TZ } from '../../common/cron-tz';
import { formatVnDate, vnDateParts, vnMonthKey } from '../../common/vn-time';
import { REAL_USER_SQL, REAL_USER_WHERE } from '../../common/real-user';
import { voucherCode } from './voucher-code';

type GrantFailures = { count: number; first?: unknown };

export type CronBatchResult = { skipped: 'RUNNING' | 'LOCKED' | 'ERROR' } | { granted: number; scanned: number };

/**
 * Voucher tự động (Build Spec §6.6): welcome / birthday / win-back / milestone.
 * Tạo coupon cá nhân (scope USER_GROUP + scopeMeta.userId) — code duy nhất, usageLimit=1
 * nên chỉ user đó dùng được. Hiển thị ở kho voucher qua loyalty.getAvailableCoupons.
 * Mọi tham số đọc từ SystemConfig (không hard-code).
 */
@Injectable()
export class VouchersService {
  private static readonly WELCOME_PAGE = 200;
  private static readonly WELCOME_WINDOW_MS = 24 * 3600 * 1000;
  /** Trần an toàn: 200 × 25 = 5.000 user/giờ, đủ cho mọi chiến dịch thực tế. */
  private static readonly WELCOME_MAX_PAGES = 25;
  /** Kích thước lô keyset cho birthday/winback (quét đến hết, không có trần số trang). */
  private static readonly BATCH_PAGE = 500;
  /** Kích thước trang keyset của milestone: quét hết khách đạt mốc trong tháng, không có trần số trang. */
  private static readonly MILESTONE_PAGE = 1000;
  /**
   * Số grant() chạy cùng lúc trong mỗi lô của mọi cron dùng grantInChunks (welcome, birthday, winback, milestone, second-order);
   * mỗi grant giữ 1 kết nối Prisma ngắn hạn. Welcome chạy mỗi giờ nên trùng giờ với second-order lúc 10:00: tối đa 20 grant
   * cùng lúc, cộng 1 kết nối second-order giữ trong $transaction cho advisory lock, so với connection_limit=20 của
   * docker-compose.vietnix.yml. Hàng chờ pool (pool_timeout=30) hấp thụ phần vượt, nên khi tăng GRANT_CONCURRENCY hoặc thêm
   * cron chạy cùng giờ phải tính lại tổng này.
   */
  private static readonly GRANT_CONCURRENCY = 10;
  /** Số dòng log lỗi từng user mỗi lượt; phần còn lại chỉ nằm trong dòng tổng kết. */
  private static readonly MAX_FAILURE_LOGS = 20;
  /** Cửa sổ NS-1 (analytics-aggregation NS1_WINDOW_DAYS): đơn thứ 2 tính trong 30 ngày kể từ đơn đầu. */
  private static readonly NS1_WINDOW_DAYS = 30;
  private static readonly SECOND_ORDER_PAGE = 200;
  /** Trần mỗi lượt 200 × 25 = 5.000 khách; phần dư lượt ngày mai lấy tiếp (mã đã cấp bị loại khỏi truy vấn). */
  private static readonly SECOND_ORDER_MAX_PAGES = 25;
  private static readonly SECOND_ORDER_LOCK = 'cron:vouchers.second_order';

  private readonly logger = new Logger(VouchersService.name);
  private secondOrderRunning = false;

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
    /** Hạn cố định thay cho now + validDays. */
    endAt?: Date;
    templateCode: string;
  }): Promise<boolean> {
    // Dùng full userId (không slice 6) để tránh false-skip khi 2 cuid trùng tiền tố.
    const code = voucherCode(opts.reason, opts.userId);
    const existed = await this.prisma.coupon.findUnique({ where: { code } });
    if (existed) return false;

    const now = new Date();
    const endAt = opts.endAt ?? new Date(now.getTime() + opts.validDays * 864e5);
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
        // Chỉ mã giảm tiền mới đọc như số tiền; giá trị % để nguyên.
        value: opts.type === 'AMOUNT' ? opts.value.toLocaleString('vi-VN') : String(opts.value),
        // Cả cụm câu (không chỉ con số) để mã không có đơn tối thiểu không in "cho đơn từ 0đ".
        min_order_note: opts.minOrder ? ` cho đơn từ ${opts.minOrder.toLocaleString('vi-VN')}đ` : '',
        expires: formatVnDate(endAt),
      })
      .catch(() => undefined);
    return true;
  }

  /**
   * Cấp theo nhóm song song có giới hạn (GRANT_CONCURRENCY), trả số coupon thực sự mới tạo. Một grant lỗi KHÔNG dừng các
   * nhóm sau: birthday chỉ quét đúng ngày sinh nhật, không có lượt quét lại, nên dừng giữa chừng là mất voucher của những
   * người đứng sau. Lỗi được ghi vào `failures` (log từng dòng có trần, tổng kết ở `reportGrantFailures`).
   */
  private async grantInChunks<T>(
    label: string,
    items: T[],
    toOpts: (item: T) => Parameters<VouchersService['grant']>[0],
    failures: GrantFailures,
  ): Promise<number> {
    let granted = 0;
    for (let i = 0; i < items.length; i += VouchersService.GRANT_CONCURRENCY) {
      const chunk = items.slice(i, i + VouchersService.GRANT_CONCURRENCY).map(toOpts);
      const results = await Promise.allSettled(chunk.map((opts) => this.grant(opts)));
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          if (r.value) granted++;
          return;
        }
        failures.count++;
        failures.first ??= r.reason;
        if (failures.count <= VouchersService.MAX_FAILURE_LOGS) {
          this.logger.error(`${label} lỗi cấp cho user ${chunk[idx]!.userId}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
        }
      });
    }
    return granted;
  }

  /** Một dòng tổng kết mỗi lượt chạy để cảnh báo vẫn thấy lỗi dù các nhóm sau đã được xử lý tiếp. */
  private reportGrantFailures(label: string, failures: GrantFailures, granted: number): void {
    if (failures.count === 0) return;
    this.logger.error(`${label} lỗi: ${failures.count} lượt cấp thất bại, ${granted} đã cấp (lỗi đầu: ${failures.first instanceof Error ? failures.first.message : failures.first})`);
  }

  /** Khách thật, chưa có đơn nào, tạo trong cửa sổ 24h: một điều kiện cho cả cron lẫn đường cấp ngay lúc đăng ký. */
  private welcomeWhere(): Prisma.UserWhereInput {
    return {
      createdAt: { gte: new Date(Date.now() - VouchersService.WELCOME_WINDOW_MS) },
      role: 'CUSTOMER',
      orders: { none: {} },
      ...REAL_USER_WHERE,
    };
  }

  private async welcomeTerms(): Promise<Omit<Parameters<VouchersService['grant']>[0], 'userId'>> {
    const value = await this.config.get<number>('voucher.welcome_amount', 30000);
    const minOrder = await this.config.get<number>('voucher.welcome_min_order', 199000);
    return { reason: 'WELCOME', type: 'AMOUNT', value, minOrder, validDays: 30, templateCode: 'WELCOME_VOUCHER' };
  }

  /**
   * D2-07a: cấp voucher chào mừng NGAY khi tài khoản thật được tạo, để lần mở đầu khách đã thấy mã thay vì chờ cron giờ sau.
   * Cùng điều kiện và cùng grant() (code tất định WELCOME-<userId>) với cron nên gọi trùng, hay chạy song song với cron, vẫn
   * chỉ một mã; cron vẫn là lưới khi bước này lỗi. Trả true khi vừa tạo mã mới.
   */
  async grantWelcomeNow(userId: string): Promise<boolean> {
    const eligible = await this.prisma.user.findFirst({ where: { id: userId, ...this.welcomeWhere() }, select: { id: true } });
    if (!eligible) return false;
    return this.grant({ userId, ...(await this.welcomeTerms()) });
  }

  /**
   * Welcome: user mới (24h) chưa có đơn → voucher chào mừng. Chạy mỗi giờ.
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — findMany lỗi giữa lúc phân trang ném ra
   * ngoài là unhandledRejection, Node 20 mặc định crash cả process. Lỗi cấp/notify từng user đã
   * được `grant()` tự cô lập (P2002 nuốt, notify `.catch(() => undefined)`).
   */
  @Cron(CronExpression.EVERY_HOUR, { timeZone: CRON_TZ })
  async welcomeVouchers(): Promise<void> {
    const failures: GrantFailures = { count: 0 };
    let granted = 0;
    try {
      const terms = await this.welcomeTerms();
      const where = this.welcomeWhere();

      // Quét HẾT cửa sổ 24h bằng cursor thay vì lấy đúng 200 user cũ nhất.
      //
      // Vì sao: `grant()` trả false ngay với user đã cấp (code tất định theo userId), nên một lô
      // 200 cố định phần lớn là người đã cấp từ lượt trước. Một chiến dịch kéo 1.000 đăng ký trong
      // một giờ khiến 800 người mới chỉ leo lên top-200 khi lứa cũ rời cửa sổ 24h — mà cả nhóm rời
      // gần như cùng lúc. Hàng trăm khách mới KHÔNG BAO GIỜ nhận voucher chào mừng, không lỗi nào
      // được ghi.
      let scanned = 0;
      let cursor: string | undefined;
      for (let page = 0; page < VouchersService.WELCOME_MAX_PAGES; page++) {
        const users = await this.prisma.user.findMany({
          // Thiếu filter `orders: { none: {} }` thì user đã đặt đơn trong 24h đầu vẫn bị cấp voucher chào mừng, sai business rule.
          where,
          orderBy: { id: 'asc' }, // khoá cursor ổn định (createdAt có thể trùng nhau hàng loạt)
          take: VouchersService.WELCOME_PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true },
        });
        if (users.length === 0) break;
        scanned += users.length;
        cursor = users[users.length - 1]!.id;
        granted += await this.grantInChunks('welcomeVouchers', users, (u) => ({ userId: u.id, ...terms }), failures);
        if (users.length < VouchersService.WELCOME_PAGE) break;
      }
      if (granted) this.logger.log(`Welcome vouchers granted: ${granted}/${scanned} user trong cửa sổ 24h.`);
    } catch (err) {
      this.logger.error(`welcomeVouchers lỗi: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.reportGrantFailures('welcomeVouchers', failures, granted);
    }
  }

  /**
   * Birthday: user có dob trùng ngày hôm nay. Chạy 1 giờ sáng hằng ngày.
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — $queryRaw lỗi ném ra ngoài là
   * unhandledRejection, Node 20 mặc định crash cả process.
   */
  @Cron('0 1 * * *', { timeZone: CRON_TZ })
  async birthdayVouchers(): Promise<void> {
    const failures: GrantFailures = { count: 0 };
    let granted = 0;
    try {
      const { year, month: mm, day: dd } = vnDateParts();
      const defaultValue = await this.config.get<number>('voucher.birthday_amount', 50000);
      // Mức riêng theo hạng (birthdayVoucherAmount null = hạng chưa có/không hứa mức riêng →
      // dùng mặc định chung, không phải 0 — không tự ý cắt quyền lợi hạng cơ bản đang có).
      const tiers = await this.prisma.membershipTier.findMany({ select: { id: true, birthdayVoucherAmount: true } });
      const amountByTier = new Map(tiers.map((t) => [t.id, t.birthdayVoucherAmount]));
      const reason = `BIRTHDAY-${year}-${mm}`;
      // Keyset theo id: trước đây một lần `LIMIT 500` không ORDER BY — ngày có > 500 người cùng
      // sinh nhật thì phần dư không bao giờ được cấp (Postgres trả tập tuỳ ý, mỗi lần chạy như
      // nhau). Chạy lại/2 instance song song vẫn an toàn nhờ code coupon tất định trong grant().
      let cursor = '';
      for (;;) {
        // Lấy kèm tierId để cấp ĐÚNG mức hạng đã hứa (P0 A3-05 — xem prisma/seed.ts TIERS[].perks).
        const users = await this.prisma.$queryRaw<{ id: string; tierId: string | null }[]>`
          SELECT u.id, u."tierId" FROM users u
          WHERE u.dob IS NOT NULL
            AND EXTRACT(MONTH FROM u.dob) = ${mm}
            AND EXTRACT(DAY FROM u.dob) = ${dd}
            AND ${REAL_USER_SQL}
            AND u.id > ${cursor}
          ORDER BY u.id
          LIMIT ${VouchersService.BATCH_PAGE}`;
        granted += await this.grantInChunks('birthdayVouchers', users, (u) => {
          const value = (u.tierId ? amountByTier.get(u.tierId) : null) ?? defaultValue;
          return { userId: u.id, reason, type: 'AMOUNT', value, validDays: 30, templateCode: 'BIRTHDAY_VOUCHER' };
        }, failures);
        if (users.length < VouchersService.BATCH_PAGE) break;
        cursor = users[users.length - 1]!.id;
      }
      if (granted) this.logger.log(`Birthday vouchers granted: ${granted}`);
    } catch (err) {
      this.logger.error(`birthdayVouchers lỗi: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.reportGrantFailures('birthdayVouchers', failures, granted);
    }
  }

  /**
   * Win-back: user từng mua nhưng >60 ngày không đặt đơn. Chạy 2 giờ sáng.
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — $queryRaw lỗi ném ra ngoài là
   * unhandledRejection, Node 20 mặc định crash cả process.
   */
  @Cron('0 2 * * *', { timeZone: CRON_TZ })
  async winbackVouchers(): Promise<void> {
    const failures: GrantFailures = { count: 0 };
    let granted = 0;
    try {
      const days = await this.config.get<number>('voucher.winback_days', 60);
      const cutoff = new Date(Date.now() - days * 864e5);
      const value = await this.config.get<number>('voucher.winback_amount', 50000);
      const reason = `WINBACK-${vnMonthKey()}`;
      // Keyset theo userId, cùng lý do với birthdayVouchers (LIMIT 500 không ORDER BY bỏ sót).
      let cursor = '';
      for (;;) {
        const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
          SELECT o."userId"
          FROM orders o
          JOIN users u ON u.id = o."userId"
          WHERE ${REAL_USER_SQL} AND o."userId" > ${cursor}
          GROUP BY o."userId"
          HAVING MAX(o."createdAt") < ${cutoff}
          ORDER BY o."userId"
          LIMIT ${VouchersService.BATCH_PAGE}`;
        granted += await this.grantInChunks('winbackVouchers', rows, (r) => ({
          userId: r.userId, reason, type: 'AMOUNT', value, validDays: 21, templateCode: 'WINBACK_VOUCHER',
        }), failures);
        if (rows.length < VouchersService.BATCH_PAGE) break;
        cursor = rows[rows.length - 1]!.userId;
      }
      if (granted) this.logger.log(`Win-back vouchers granted: ${granted}`);
    } catch (err) {
      this.logger.error(`winbackVouchers lỗi: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.reportGrantFailures('winbackVouchers', failures, granted);
    }
  }

  /**
   * Milestone (§6.6): chi tiêu đạt mốc trong 30 ngày → voucher tri ân. Chạy 5h sáng.
   * Mặc định 1tr→30k, 3tr→100k, 5tr→200k. Idempotent theo (mốc, tháng) qua grant.
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — $queryRaw lỗi ném ra ngoài là
   * unhandledRejection, Node 20 mặc định crash cả process.
   */
  @Cron('0 5 * * *', { timeZone: CRON_TZ })
  async milestoneVouchers(): Promise<void> {
    const failures: GrantFailures = { count: 0 };
    let granted = 0;
    try {
      const milestones = await this.config.get<{ spend: number; reward: number }[]>('voucher.milestones', [
        { spend: 1_000_000, reward: 30_000 },
        { spend: 3_000_000, reward: 100_000 },
        { spend: 5_000_000, reward: 200_000 },
      ]);
      // Cửa sổ tính PHẢI khớp với khoá idempotency bên dưới (`...-yyyy-mm`). Trước đây gom theo
      // 30 ngày TRƯỢT nhưng khoá theo THÁNG: cùng một lần chi tiêu nằm trong cửa sổ trượt sinh
      // khoá khác khi sang tháng mới → cấp voucher lần 2 cho đúng số tiền đó (P2,
      // docs/2026-09-08-review-progress.md). Nay cả hai cùng dùng tháng dương lịch GIỜ VN
      // (container chạy UTC nên phải trừ offset, nếu không mốc tháng lệch 7 tiếng).
      const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
      const nowVn = new Date(Date.now() + VN_OFFSET_MS);
      const since = new Date(Date.UTC(nowVn.getUTCFullYear(), nowVn.getUTCMonth(), 1) - VN_OFFSET_MS);
      // Chi tiêu RÒNG: đơn đã giao nhưng được trả MỘT PHẦN vẫn ở DELIVERED với nguyên `total`, nên trừ tiền hàng + ship đã
      // hoàn của các yêu cầu APPROVED (fullReturn=false, cùng định nghĩa LoyaltyService.partialReturnsByOrder), kẹp ở 0.
      // Voucher mốc đã cấp từ trước KHÔNG thu hồi: coupon đã phát cho khách, chỉ lượt cấp sau mới tính theo số ròng.
      const period = nowVn.toISOString().slice(0, 7); // yyyy-mm theo giờ VN
      // Cấp voucher cho mốc CAO NHẤT đạt được (tránh chồng nhiều voucher 1 đợt).
      const byDescSpend = [...milestones].sort((a, b) => b.spend - a.spend);
      const lowestSpend = byDescSpend[byDescSpend.length - 1]?.spend;
      if (lowestSpend === undefined) return;
      // Phân trang keyset theo userId: trước đây `GROUP BY ... LIMIT 1000` không ORDER BY nên khách ngoài 1000 dòng đầu
      // không bao giờ được xét, lượt nào cũng lấy lại đúng nhóm đó. HAVING loại người dưới mốc thấp nhất ngay trong SQL
      // để trang không bị chiếm bởi khách không đủ điều kiện; kết quả cấp không đổi vì hit chỉ có khi spent >= mốc thấp nhất.
      let cursor = '';
      for (;;) {
        const rows = await this.prisma.$queryRaw<{ userId: string; spent: bigint }[]>`
          SELECT o."userId", GREATEST(SUM(o."total") - COALESCE(SUM(rr."refunded"), 0), 0) AS spent
          FROM orders o
          LEFT JOIN (
            SELECT "orderId", SUM(COALESCE("refundAmount", 0) + "shippingRefund") AS refunded
            FROM return_requests
            WHERE status::text = 'APPROVED' AND "fullReturn" = false
            GROUP BY "orderId"
          ) rr ON rr."orderId" = o.id
          JOIN users u ON u.id = o."userId"
          WHERE o.status::text = 'DELIVERED' AND o."createdAt" >= ${since} AND o."userId" > ${cursor}
            AND ${REAL_USER_SQL}
          GROUP BY o."userId"
          HAVING GREATEST(SUM(o."total") - COALESCE(SUM(rr."refunded"), 0), 0) >= ${lowestSpend}
          ORDER BY o."userId"
          LIMIT ${VouchersService.MILESTONE_PAGE}`;
        const hits = rows.flatMap((r) => {
          const spent = Number(r.spent);
          const hit = byDescSpend.find((m) => spent >= m.spend);
          return hit ? [{ userId: r.userId, hit }] : [];
        });
        granted += await this.grantInChunks('milestoneVouchers', hits, ({ userId, hit }) => ({
          userId, reason: `MILESTONE${hit.spend}-${period}`, type: 'AMOUNT', value: hit.reward, validDays: 30, templateCode: 'MILESTONE_VOUCHER',
        }), failures);
        if (rows.length < VouchersService.MILESTONE_PAGE) break;
        cursor = rows[rows.length - 1]!.userId;
      }
      if (granted) this.logger.log(`Milestone vouchers granted: ${granted}`);
    } catch (err) {
      this.logger.error(`milestoneVouchers lỗi: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.reportGrantFailures('milestoneVouchers', failures, granted);
    }
  }

  /**
   * Đơn thứ 2 (C-017, north-star NS-1 "đơn thứ 2 trong 30 ngày kể từ đơn đầu"): khách thật có đúng một đơn (không tính
   * đơn huỷ), đơn đó đã giao được `voucher.second_order_delay_days` ngày → mã giảm giá hạn tới hết cửa sổ 30 ngày.
   * Mỗi khách một mã cả đời (code tất định `SECOND-ORDER-<userId>`). Còn dưới `voucher.second_order_min_remaining_days`
   * ngày thì bỏ, vì mã sắp hết hạn chỉ làm phiền. Tin đi qua NotificationsService nên khách tắt "Khuyến mãi" không nhận
   * tin (SECOND_ORDER_VOUCHER là nhóm PROMO), mã vẫn nằm trong kho voucher.
   *
   * Không xét: đơn lên hộ (userId là CTV), đơn đại lý, đơn sinh từ gói định kỳ và khách còn gói định kỳ (đơn kế tiếp
   * đã tự có, giảm giá chỉ là chi phí).
   */
  @Cron('0 10 * * *', { timeZone: CRON_TZ })
  async secondOrderVouchers(): Promise<CronBatchResult> {
    if (this.secondOrderRunning) return { skipped: 'RUNNING' };
    this.secondOrderRunning = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt (nhiều instance cùng lịch thì chỉ một chạy); việc cấp chạy trên
      // kết nối khác nên mã đã cấp vẫn giữ khi lượt bị ngắt giữa chừng. Code coupon @unique vẫn là chốt cuối.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${VouchersService.SECOND_ORDER_LOCK})) AS "locked"`;
          if (!row?.locked) return { skipped: 'LOCKED' as const };
          return this.grantSecondOrderBatches();
        },
        { maxWait: 10_000, timeout: 10 * 60_000 },
      );
    } catch (err) {
      this.logger.error(`secondOrderVouchers lỗi: ${err instanceof Error ? err.message : err}`);
      return { skipped: 'ERROR' };
    } finally {
      this.secondOrderRunning = false;
    }
  }

  private async grantSecondOrderBatches(): Promise<{ granted: number; scanned: number }> {
    const value = await this.config.get<number>('voucher.second_order_amount', 30000);
    const minOrder = await this.config.get<number>('voucher.second_order_min_order', 199000);
    const delayDays = await this.config.get<number>('voucher.second_order_delay_days', 3);
    const minRemainingDays = await this.config.get<number>('voucher.second_order_min_remaining_days', 3);
    const now = Date.now();
    const deliveredBefore = new Date(now - delayDays * 864e5);
    const createdAfter = new Date(now - (VouchersService.NS1_WINDOW_DAYS - minRemainingDays) * 864e5);

    const failures: GrantFailures = { count: 0 };
    let granted = 0;
    let scanned = 0;
    let cursor = '';
    try {
      for (let page = 0; page < VouchersService.SECOND_ORDER_MAX_PAGES; page++) {
        const rows = await this.prisma.$queryRaw<{ userId: string; firstAt: Date }[]>`
          SELECT o."userId", o."createdAt" AS "firstAt"
          FROM orders o
          JOIN users u ON u.id = o."userId"
          WHERE o.status::text = 'DELIVERED'
            AND o.type::text = 'RETAIL'
            AND o."placedForCustomer" = false
            AND o."subscriptionId" IS NULL
            AND o."createdAt" >= ${createdAfter}
            AND o."deliveredAt" IS NOT NULL AND o."deliveredAt" <= ${deliveredBefore}
            AND u.role::text = 'CUSTOMER'
            AND ${REAL_USER_SQL}
            AND o."userId" > ${cursor}
            AND NOT EXISTS (
              SELECT 1 FROM orders o2
              WHERE o2."userId" = o."userId" AND o2.id <> o.id AND o2.status::text <> 'CANCELLED')
            AND NOT EXISTS (
              SELECT 1 FROM subscriptions s
              WHERE s."userId" = o."userId" AND s.status IN ('ACTIVE', 'PAUSED'))
            AND NOT EXISTS (
              SELECT 1 FROM coupons c WHERE c.code = upper('SECOND-ORDER-' || o."userId"))
          ORDER BY o."userId"
          LIMIT ${VouchersService.SECOND_ORDER_PAGE}`;
        scanned += rows.length;
        granted += await this.grantInChunks('secondOrderVouchers', rows, (r) => ({
          userId: r.userId,
          reason: 'SECOND-ORDER',
          type: 'AMOUNT',
          value,
          minOrder,
          validDays: VouchersService.NS1_WINDOW_DAYS,
          endAt: new Date(new Date(r.firstAt).getTime() + VouchersService.NS1_WINDOW_DAYS * 864e5),
          templateCode: 'SECOND_ORDER_VOUCHER',
        }), failures);
        if (rows.length < VouchersService.SECOND_ORDER_PAGE) break;
        cursor = rows[rows.length - 1]!.userId;
      }
    } finally {
      this.reportGrantFailures('secondOrderVouchers', failures, granted);
    }
    if (granted) this.logger.log(`Second-order vouchers granted: ${granted}/${scanned}`);
    return { granted, scanned };
  }
}
