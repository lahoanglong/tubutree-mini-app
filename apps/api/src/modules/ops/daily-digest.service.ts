import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { CRON_TZ } from '../../common/cron-tz';
import { RunLease } from '../../common/cron-leader/run-lease';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { PrismaService } from '../../prisma/prisma.service';
import { GMV_ORDER_SQL, REVENUE_ORDER_SQL } from '../admin/admin-revenue';
import { SELLABLE_PANCAKE_VARIATION_WHERE } from '../cart/sellable';
import { isZeroResultCandidate, zeroResultSql } from '../catalog/search-synonyms-zero-results.service';
import {
  DIGEST_LOW_STOCK_LIST_MAX,
  DIGEST_LOW_STOCK_MAX,
  DIGEST_ORDER_LIST_MAX,
  DIGEST_SECTIONS,
  DIGEST_STUCK_HOURS,
  DIGEST_ZERO_RESULT_TOP,
  digestDayFor,
  digestDayRange,
  type DailyDigest,
  type DigestLowStock,
  type DigestOrders,
  type DigestStuckOrders,
  type DigestUnpaidTransfers,
  type DigestZeroResult,
} from './daily-digest';
import { OpsEmailService } from './ops-email.service';
import { ServerErrorCounterService } from './server-error-counter.service';

/** Dòng `ops_health_states` nhớ ngày đã gửi bản tin (`detail.day`), để các lượt gửi bù trong buổi sáng không gửi lại. */
export const DIGEST_STATE_KEY = 'ops.daily-digest';
const DIGEST_LEASE = 'ops.daily-digest';
const DIGEST_LEASE_TTL_MS = 10 * 60_000;
/** SQL lấy dư cụm tìm ra trống để lọc TS (`isZeroResultCandidate`) bỏ bớt mà vẫn đủ top. */
const ZERO_RESULT_SQL_LIMIT = DIGEST_ZERO_RESULT_TOP * 4;

const ts = (d: Date): string => d.toISOString();

/**
 * - SENT: đã gửi bản tin của ngày; ALREADY_SENT: lượt trước đã gửi (hoặc đã chốt bỏ vì lỗi vĩnh viễn) nên lượt này không làm gì;
 * - NOT_CONFIGURED: kênh email chưa cấu hình đủ; LOCKED: replica khác đang gửi;
 * - RETRY: lỗi tạm thời (SMTP, mọi truy vấn số liệu lỗi) — lượt gửi bù sau thử lại; BLOCKED: lỗi SMTP vĩnh viễn, không thử lại trong ngày.
 */
export type DigestRunResult = 'SENT' | 'ALREADY_SENT' | 'NOT_CONFIGURED' | 'LOCKED' | 'RETRY' | 'BLOCKED';

interface OrdersRow {
  placed: number;
  cancelled: number;
  paid_orders: number;
  gross: bigint | number;
  partial_refund: bigint | number;
  gmv: bigint | number;
}

interface StuckRow {
  code: string;
  status: string;
  since: Date;
  total: bigint | number;
}

interface ZeroRow {
  term: string;
  count: number | bigint;
}

/**
 * Bản tin sáng 08:00 (giờ VN) gửi chủ shop qua email vận hành: đơn và doanh thu hôm qua, chuyển khoản còn chờ, đơn kẹt quá 48 giờ, hàng kho
 * Tubu còn từ 5 trở xuống, từ khoá tìm không ra hôm qua và số lỗi 5xx hôm qua. Chỉ ĐỌC; không đổi đơn, tồn hay cấu hình nào.
 *
 * Một mục lỗi truy vấn thì thư vẫn gửi, mục đó ghi rõ là chưa đọc được (log error để màn Tác vụ nền báo). Cả sáu mục cùng lỗi (DB sập) thì
 * không gửi thư rỗng mà để lượt gửi bù sau.
 */
@Injectable()
export class DailyDigestService {
  private readonly logger = new Logger(DailyDigestService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: OpsEmailService,
    private readonly serverErrors: ServerErrorCounterService,
  ) {}

  // 08:00 gửi; 08:30 … 10:30 chỉ gửi bù khi 08:00 chưa gửi được (lỗi SMTP tạm thời, API đang khởi động lại lúc 08:00).
  // Toàn thân bọc try/catch: @Cron không tự bắt lỗi — lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 0,30 8-10 * * *', { name: 'ops.daily-digest', timeZone: CRON_TZ })
  @TrackCron()
  async handleCron(): Promise<void> {
    if (this.running) {
      markCronSkipped('RUNNING');
      return;
    }
    this.running = true;
    try {
      const res = await this.run();
      if (res === 'NOT_CONFIGURED' || res === 'LOCKED') markCronSkipped(res);
      if (res === 'SENT') this.logger.log('Đã gửi bản tin sáng cho chủ shop.');
    } catch (err) {
      this.logger.error(`Bản tin sáng lỗi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  async run(now: Date = new Date()): Promise<DigestRunResult> {
    if (!this.email.isReady()) return 'NOT_CONFIGURED';
    const day = digestDayFor(now);
    const lease = await RunLease.tryAcquire(this.prisma, DIGEST_LEASE, DIGEST_LEASE_TTL_MS);
    if (!lease) return 'LOCKED';
    try {
      if ((await this.doneDay()) === day) return 'ALREADY_SENT';
      // Kênh đang bị chặn vì lỗi vĩnh viễn (sai mật khẩu…) mà cấu hình chưa đổi: không gom số liệu, không gõ cửa SMTP.
      if (!(await this.email.blockLifted())) return 'BLOCKED';

      const digest = await this.collect(day, now);
      if (DIGEST_SECTIONS.every((k) => digest[k] === null)) {
        this.logger.error(`Bản tin sáng ngày ${day}: không đọc được mục số liệu nào, chờ lượt gửi bù.`);
        return 'RETRY';
      }
      const outcome = await this.email.sendDigest(digest);
      if (outcome === 'NOT_READY') return 'NOT_CONFIGURED';
      if (outcome === 'RETRY') return 'RETRY';
      // SENT, hoặc BLOCKED: lỗi vĩnh viễn thì thôi ngày này, gửi lại cùng cấu hình chỉ bị từ chối tiếp.
      await this.markDone(day, outcome, now);
      return outcome;
    } finally {
      await lease.release();
    }
  }

  private async doneDay(): Promise<string | null> {
    const row = await this.prisma.opsHealthState.findUnique({ where: { key: DIGEST_STATE_KEY }, select: { detail: true } });
    const day = (row?.detail as { day?: unknown } | null)?.day;
    return typeof day === 'string' ? day : null;
  }

  private async markDone(day: string, outcome: 'SENT' | 'BLOCKED', now: Date): Promise<void> {
    const data =
      outcome === 'SENT'
        ? { lastOkAt: now, detail: { day, outcome } }
        : { lastErrorAt: now, lastError: 'Kênh email từ chối vĩnh viễn, bỏ bản tin của ngày này.', detail: { day, outcome } };
    try {
      await this.prisma.opsHealthState.upsert({ where: { key: DIGEST_STATE_KEY }, create: { key: DIGEST_STATE_KEY, ...data }, update: data });
    } catch (err) {
      this.logger.error(`Đã gửi bản tin sáng ngày ${day} nhưng không ghi được mốc, lượt gửi bù có thể gửi lại: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Gom đủ sáu mục, tuần tự (mỗi lúc một kết nối DB); mục nào lỗi thì `null`. */
  async collect(day: string, now: Date = new Date()): Promise<DailyDigest> {
    const { start, end } = digestDayRange(day);
    return {
      day,
      generatedAt: now.toISOString(),
      orders: await this.section('orders', day, () => this.orders(start, end)),
      unpaidTransfers: await this.section('unpaidTransfers', day, () => this.unpaidTransfers()),
      stuckOrders: await this.section('stuckOrders', day, () => this.stuckOrders(now)),
      lowStock: await this.section('lowStock', day, () => this.lowStock()),
      zeroResults: await this.section('zeroResults', day, () => this.zeroResults(start, end)),
      serverErrors: await this.section('serverErrors', day, () => this.serverErrors.countForDay(day)),
    };
  }

  private async section<T>(name: string, day: string, load: () => Promise<T>): Promise<T | null> {
    try {
      return await load();
    } catch (err) {
      this.logger.error(`Bản tin sáng ngày ${day}: mục ${name} lỗi truy vấn: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Cùng truy vấn và định nghĩa với báo cáo Doanh thu (admin-reports.service), gộp thành một dòng cho cả ngày VN. */
  private async orders(start: Date, end: Date): Promise<DigestOrders> {
    const [r] = await this.prisma.$queryRaw<OrdersRow[]>(Prisma.sql`
      SELECT COUNT(*)::int AS placed,
             COUNT(*) FILTER (WHERE o.status IN ('CANCELLED', 'RETURNED'))::int AS cancelled,
             COUNT(*) FILTER (WHERE ${REVENUE_ORDER_SQL})::int AS paid_orders,
             COALESCE(SUM(o.total) FILTER (WHERE ${REVENUE_ORDER_SQL}), 0)::bigint AS gross,
             COALESCE(SUM(pr.refund) FILTER (WHERE ${REVENUE_ORDER_SQL}), 0)::bigint AS partial_refund,
             COALESCE(SUM(o.total) FILTER (WHERE ${GMV_ORDER_SQL}), 0)::bigint AS gmv
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT SUM(r."refundAmount" + r."shippingRefund") AS refund
            FROM return_requests r
           WHERE r."orderId" = o.id AND r.status = 'APPROVED'
        ) pr ON true
       WHERE o."createdAt" >= ${ts(start)}::timestamp AND o."createdAt" < ${ts(end)}::timestamp`);
    const gross = Number(r?.gross ?? 0);
    return {
      placed: r?.placed ?? 0,
      cancelled: r?.cancelled ?? 0,
      paidOrders: r?.paid_orders ?? 0,
      revenue: gross - Number(r?.partial_refund ?? 0),
      gmv: Number(r?.gmv ?? 0),
    };
  }

  /** Cùng điều kiện với đổi sang COD và nhắc chuyển khoản: BANK_TRANSFER còn PENDING_PAYMENT + UNPAID. */
  private async unpaidTransfers(): Promise<DigestUnpaidTransfers> {
    const where: Prisma.OrderWhereInput = { status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER' };
    const [agg, oldest] = await Promise.all([
      this.prisma.order.aggregate({ where, _count: { _all: true }, _sum: { total: true } }),
      this.prisma.order.findMany({ where, orderBy: { createdAt: 'asc' }, take: DIGEST_ORDER_LIST_MAX, select: { code: true, createdAt: true, total: true } }),
    ]);
    return {
      count: agg._count._all,
      amount: agg._sum.total ?? 0,
      oldest: oldest.map((o) => ({ code: o.code, createdAt: o.createdAt.toISOString(), total: o.total })),
    };
  }

  /**
   * Đơn CONFIRMED/PACKED mà lần VÀO trạng thái hiện tại (dòng order_status_history đổi sang trạng thái đó; dòng ghi chú cùng trạng thái
   * không tính) hoặc, nếu không có dòng nào, lúc tạo đơn, đã quá 48 giờ. Đơn đã giao cho vận chuyển (SHIPPING) không tính: đường đi vài ngày
   * là bình thường.
   */
  private async stuckOrders(now: Date): Promise<DigestStuckOrders> {
    const cutoff = new Date(now.getTime() - DIGEST_STUCK_HOURS * 3_600_000);
    const rows = await this.prisma.$queryRaw<StuckRow[]>`
      SELECT s.code, s.status, s.since, COUNT(*) OVER () AS total
        FROM (
          SELECT o.code, o.status::text AS status, COALESCE(h.at, o."createdAt") AS since
            FROM orders o
            LEFT JOIN LATERAL (
              SELECT max(h."createdAt") AS at
                FROM order_status_history h
               WHERE h."orderId" = o.id AND h."toStatus" = o.status::text AND h."fromStatus" IS DISTINCT FROM h."toStatus"
            ) h ON true
           WHERE o.status IN ('CONFIRMED', 'PACKED')
        ) s
       WHERE s.since < ${ts(cutoff)}::timestamp
       ORDER BY s.since ASC, s.code ASC
       LIMIT ${DIGEST_ORDER_LIST_MAX}`;
    return {
      count: rows.length > 0 ? Number(rows[0]!.total) : 0,
      oldest: rows.map((r) => ({ code: r.code, status: r.status, since: new Date(r.since).toISOString() })),
    };
  }

  /** Biến thể bán được do kho Tubu giao qua Pancake (`SELLABLE_PANCAKE_VARIATION_WHERE`), tồn bán được ≤ 5; hết hàng đứng đầu. */
  private async lowStock(): Promise<DigestLowStock> {
    const where: Prisma.VariationWhereInput = { ...SELLABLE_PANCAKE_VARIATION_WHERE, stock: { lte: DIGEST_LOW_STOCK_MAX } };
    const [count, outOfStock, items] = await Promise.all([
      this.prisma.variation.count({ where }),
      this.prisma.variation.count({ where: { ...SELLABLE_PANCAKE_VARIATION_WHERE, stock: { lte: 0 } } }),
      this.prisma.variation.findMany({
        where,
        orderBy: [{ stock: 'asc' }, { sku: 'asc' }],
        take: DIGEST_LOW_STOCK_LIST_MAX,
        select: { sku: true, name: true, stock: true, product: { select: { name: true } } },
      }),
    ]);
    return {
      count,
      outOfStock,
      items: items.map((v) => ({ sku: v.sku, name: v.name && v.name !== v.product.name ? `${v.product.name} ${v.name}` : v.product.name, stock: v.stock })),
    };
  }

  /** Cùng truy vấn và bộ lọc rác/SĐT/email với thẻ "Từ khoá tìm chưa ra" của admin, khung là ngày VN hôm qua. */
  private async zeroResults(start: Date, end: Date): Promise<DigestZeroResult[]> {
    const rows = await this.prisma.$queryRaw<ZeroRow[]>(zeroResultSql(start, new Date(end.getTime() - 1), ZERO_RESULT_SQL_LIMIT));
    // Cùng chuẩn hoá với SearchZeroResultsService.report: NFC, hạ chữ hoa có dấu mà lower() của Postgres (collation C) bỏ sót.
    return rows
      .map((r) => ({ term: typeof r.term === 'string' ? r.term.normalize('NFC').toLocaleLowerCase('vi') : '', count: Number(r.count) }))
      .filter((r) => isZeroResultCandidate(r.term))
      .slice(0, DIGEST_ZERO_RESULT_TOP);
  }
}
