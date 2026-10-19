import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { escapePrismaLike } from '../catalog/search-text';
import { startOfVnMonth, vnMonthKey, VN_OFFSET_MS } from '../../common/vn-time';
import { paginated } from '../../common/pagination';
import { DEALER_SETTLED_STATUSES } from './dealer.service';
import {
  DEALER_MAX_DISCOUNT_KEY,
  DEFAULT_DEALER_MAX_DISCOUNT,
  discountFractionToPct,
  discountPctToFraction,
  resolveMaxDiscount,
  tierProblems,
  type TierInput,
} from './dealer-tier-input';

type DbTier = {
  id: string;
  name: string;
  minOrderVolume: number;
  discountRules: unknown;
  creditLimit: number;
  paymentTerms: string | null;
};

export interface TierView {
  id: string;
  name: string;
  minOrderVolume: number;
  /** Phần trăm (30 = 30%). */
  discountPct: number;
  creditLimit: number;
  paymentTerms: string | null;
}

const rulesOf = (raw: unknown): Record<string, unknown> =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};

/** Chiết khấu mặc định của bậc, đúng như DealerService.dealerContext đọc (`rules.default ?? 0.2`). */
const tierDiscountFraction = (raw: unknown): number => {
  const d = rulesOf(raw).default;
  return typeof d === 'number' && Number.isFinite(d) ? d : 0.2;
};

const toView = (t: DbTier): TierView => ({
  id: t.id,
  name: t.name,
  minOrderVolume: t.minOrderVolume,
  discountPct: discountFractionToPct(tierDiscountFraction(t.discountRules)),
  creditLimit: t.creditLimit,
  paymentTerms: t.paymentTerms,
});

const snapshot = (v: TierView) => ({
  name: v.name,
  minOrderVolume: v.minOrderVolume,
  discountPct: v.discountPct,
  creditLimit: v.creditLimit,
  paymentTerms: v.paymentTerms,
});

const cleanTerms = (t: string | null | undefined): string | null => (t && t.length > 0 ? t : null);

const sameTier = (a: ReturnType<typeof snapshot>, b: TierInput): boolean =>
  a.name === b.name.trim() &&
  a.minOrderVolume === b.minOrderVolume &&
  a.discountPct === b.discountPct &&
  a.creditLimit === b.creditLimit &&
  a.paymentTerms === cleanTerms(b.paymentTerms);

export interface AccountsQuery {
  page: number;
  limit: number;
  search?: string;
  tierId?: string;
  debtOnly?: boolean;
}

const SETTLED_SQL = Prisma.raw(DEALER_SETTLED_STATUSES.map((s) => `'${s}'`).join(', '));

/**
 * Admin xem đại lý đã duyệt kèm công nợ và sửa bậc đại lý (D1-06). Không có đường tiền mới: ghi nhận khoản đại lý trả vẫn
 * là POST admin/dealers/:userId/credit-payment (DealerService.adminRecordCreditPayment); ở đây chỉ đọc sổ công nợ.
 * Bậc là tham số tiền (chiết khấu, hạn mức) nên chỉ ADMIN sửa, chiết khấu bị chặn bởi `dealer.max_discount_pct` (cùng trần
 * DealerService.dealerContext kẹp lúc đặt đơn), mọi lần đổi để lại dòng DealerTierHistory và log.
 */
@Injectable()
export class DealerAccountsAdminService {
  private readonly logger = new Logger(DealerAccountsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  private async maxDiscount(): Promise<number> {
    return resolveMaxDiscount(await this.config.get<unknown>(DEALER_MAX_DISCOUNT_KEY, DEFAULT_DEALER_MAX_DISCOUNT));
  }

  private assertValid(input: TierInput, maxDiscount: number) {
    const problems = tierProblems(input, maxDiscount);
    if (problems.length > 0) throw new BadRequestException(problems.join(' '));
  }

  async listTiers() {
    const [tiers, counts, maxDiscount] = await Promise.all([
      this.prisma.dealerTier.findMany({ orderBy: [{ minOrderVolume: 'asc' }, { id: 'asc' }] }),
      this.prisma.$queryRaw<{ tierId: string | null; n: number }[]>`
        SELECT "metadata"->>'dealerTierId' AS "tierId", count(*)::int AS "n" FROM "users" WHERE "role" = 'DEALER' GROUP BY 1`,
      this.maxDiscount(),
    ]);
    const byTier = new Map(counts.map((c) => [c.tierId, c.n]));
    return {
      tiers: tiers.map((t) => ({ ...toView(t), dealerCount: byTier.get(t.id) ?? 0 })),
      maxDiscountPct: discountFractionToPct(maxDiscount),
      dealersWithoutTier: byTier.get(null) ?? 0,
    };
  }

  async createTier(adminId: string, input: TierInput & { id: string }): Promise<TierView> {
    this.assertValid(input, await this.maxDiscount());
    const data = {
      id: input.id,
      name: input.name.trim(),
      minOrderVolume: input.minOrderVolume,
      discountRules: { default: discountPctToFraction(input.discountPct) },
      creditLimit: input.creditLimit,
      paymentTerms: cleanTerms(input.paymentTerms),
    };
    try {
      const view = await this.prisma.$transaction(async (tx) => {
        const created = await tx.dealerTier.create({ data });
        const v = toView(created as DbTier);
        await tx.dealerTierHistory.create({
          data: { tierId: input.id, action: 'CREATE', oldValue: Prisma.JsonNull, newValue: snapshot(v), changedBy: adminId },
        });
        return v;
      });
      this.logger.warn(`Admin ${adminId} tạo bậc đại lý ${input.id}: ${JSON.stringify(snapshot(view))}.`);
      return view;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Mã bậc ${input.id} đã tồn tại. Chọn mã khác.`);
      }
      throw err;
    }
  }

  /** `expected` = giá trị bậc admin đã thấy lúc mở form: đã đổi trong lúc đó thì 409 thay vì ghi đè mất thay đổi của người khác. */
  async updateTier(adminId: string, id: string, input: TierInput, expected: TierInput): Promise<TierView> {
    this.assertValid(input, await this.maxDiscount());
    const result = await this.prisma.$transaction(async (tx) => {
      // Khoá dòng để hai admin sửa cùng bậc xếp hàng: mỗi dòng lịch sử có "cũ" đúng bằng "mới" của dòng trước.
      const [row] = await tx.$queryRaw<DbTier[]>`SELECT * FROM "dealer_tiers" WHERE "id" = ${id} FOR UPDATE`;
      if (!row) throw new NotFoundException('Không tìm thấy bậc đại lý.');
      const before = toView(row);
      const next = {
        name: input.name.trim(),
        minOrderVolume: input.minOrderVolume,
        discountPct: input.discountPct,
        creditLimit: input.creditLimit,
        paymentTerms: cleanTerms(input.paymentTerms),
      };
      if (JSON.stringify(snapshot(before)) === JSON.stringify(next)) return { view: before, changed: false, before };
      if (!sameTier(snapshot(before), expected)) {
        throw new ConflictException('Bậc này vừa được người khác sửa. Tải lại để xem giá trị mới rồi sửa lại.');
      }
      const updated = await tx.dealerTier.update({
        where: { id },
        data: {
          name: next.name,
          minOrderVolume: next.minOrderVolume,
          // Giữ khoá khác của discountRules (nếu sau này có luật theo nhóm hàng), chỉ đổi `default`.
          discountRules: { ...rulesOf(row.discountRules), default: discountPctToFraction(next.discountPct) },
          creditLimit: next.creditLimit,
          paymentTerms: next.paymentTerms,
        },
      });
      const view = toView(updated as DbTier);
      await tx.dealerTierHistory.create({
        data: { tierId: id, action: 'UPDATE', oldValue: snapshot(before), newValue: snapshot(view), changedBy: adminId },
      });
      return { view, changed: true, before };
    });
    if (result.changed) {
      this.logger.warn(
        `Admin ${adminId} sửa bậc đại lý ${id}: ${JSON.stringify(snapshot(result.before))} → ${JSON.stringify(snapshot(result.view))}.`,
      );
    }
    return result.view;
  }

  async tierHistory(take = 30) {
    const rows = await this.prisma.dealerTierHistory.findMany({ orderBy: [{ changedAt: 'desc' }, { id: 'desc' }], take });
    const admins = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.changedBy))] } },
      select: { id: true, fullName: true, phone: true },
    });
    const byId = new Map(admins.map((a) => [a.id, a]));
    return rows.map((r) => ({
      id: r.id,
      tierId: r.tierId,
      action: r.action,
      oldValue: r.oldValue,
      newValue: r.newValue,
      changedAt: r.changedAt,
      changedBy: { id: r.changedBy, fullName: byId.get(r.changedBy)?.fullName ?? null, phone: byId.get(r.changedBy)?.phone ?? null },
    }));
  }

  /**
   * Đại lý đã duyệt (role DEALER) kèm bậc, dư nợ, hạn mức, doanh số tháng này (giờ VN), nợ nhiều nhất trước.
   * Dư nợ = SUM(delta) cả sổ (dương = đang nợ, như DealerService.adminRecordCreditPayment); không dùng creditLedger() vì nó chỉ
   * cộng 200 dòng gần nhất. Doanh số "đã chốt" cùng luật DealerService.dealerVolume: đơn PACKED/SHIPPING/DELIVERED đã thanh toán
   * hoặc ghi công nợ, bỏ đơn hoàn tiền/lỗi; đơn còn lại của tháng là "chờ chốt".
   */
  async listAccounts(q: AccountsQuery, now = new Date()) {
    const search = q.search?.trim();
    const filters: Prisma.Sql[] = [Prisma.sql`u."role" = 'DEALER'`];
    if (search) {
      const like = `%${escapePrismaLike(search)}%`;
      filters.push(Prisma.sql`(u."fullName" ILIKE ${like} OR u."phone" LIKE ${like})`);
    }
    if (q.tierId) filters.push(Prisma.sql`u."metadata"->>'dealerTierId' = ${q.tierId}`);
    const monthStart = startOfVnMonth(now);
    const [y, m] = vnMonthKey(now).split('-').map(Number) as [number, number];
    const monthEnd = new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS);
    const debtFilter = q.debtOnly ? Prisma.sql`WHERE COALESCE(b."debt", 0) > 0` : Prisma.empty;

    const settled = Prisma.sql`(o."status" IN (${SETTLED_SQL}) AND (o."paymentStatus" = 'PAID' OR EXISTS (
      SELECT 1 FROM "dealer_credit_ledgers" c WHERE c."userId" = o."userId" AND c."refType" = 'ORDER' AND c."refId" = o."id")))`;
    const base = Prisma.sql`
      WITH d AS (
        SELECT u."id", u."fullName", u."phone", u."metadata"->>'dealerTierId' AS "tierId"
          FROM "users" u WHERE ${Prisma.join(filters, ' AND ')}
      ), b AS (
        SELECT l."userId", SUM(l."delta")::bigint AS "debt"
          FROM "dealer_credit_ledgers" l WHERE l."userId" IN (SELECT "id" FROM d) GROUP BY l."userId"
      ), s AS (
        SELECT o."userId",
               COALESCE(SUM(o."total") FILTER (WHERE ${settled}), 0)::bigint AS "settled",
               COALESCE(SUM(o."total") FILTER (WHERE NOT ${settled}), 0)::bigint AS "pending",
               count(*)::int AS "orders"
          FROM "orders" o
         WHERE o."type" = 'DEALER' AND o."userId" IN (SELECT "id" FROM d)
           AND o."createdAt" >= ${monthStart} AND o."createdAt" < ${monthEnd}
           AND o."status" NOT IN ('CANCELLED', 'RETURNED') AND o."paymentStatus" NOT IN ('REFUNDED', 'FAILED')
         GROUP BY o."userId"
      ), x AS (
        SELECT d."id", d."fullName", d."phone", d."tierId", t."name" AS "tierName", COALESCE(t."creditLimit", 0) AS "creditLimit",
               COALESCE(b."debt", 0) AS "debt", COALESCE(s."settled", 0) AS "monthSales", COALESCE(s."pending", 0) AS "monthPending",
               COALESCE(s."orders", 0) AS "monthOrders"
          FROM d LEFT JOIN b ON b."userId" = d."id" LEFT JOIN s ON s."userId" = d."id" LEFT JOIN "dealer_tiers" t ON t."id" = d."tierId"
          ${debtFilter}
      )`;
    const offset = (q.page - 1) * q.limit;
    type Row = {
      id: string;
      fullName: string | null;
      phone: string | null;
      tierId: string | null;
      tierName: string | null;
      creditLimit: number;
      debt: bigint;
      monthSales: bigint;
      monthPending: bigint;
      monthOrders: number;
    };
    const [rows, [agg]] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`${base}
        SELECT * FROM x ORDER BY "debt" DESC, "fullName" ASC NULLS LAST, "id" ASC LIMIT ${q.limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: number; totalDebt: bigint | null; debtors: number }[]>`${base}
        SELECT count(*)::int AS "total", SUM(GREATEST("debt", 0))::bigint AS "totalDebt", (count(*) FILTER (WHERE "debt" > 0))::int AS "debtors" FROM x`,
    ]);
    const data = rows.map((r) => {
      const debt = Number(r.debt);
      return {
        userId: r.id,
        fullName: r.fullName,
        phone: r.phone,
        tier: r.tierId ? { id: r.tierId, name: r.tierName } : null,
        creditLimit: r.creditLimit,
        debt,
        overLimit: debt > r.creditLimit,
        monthSales: Number(r.monthSales),
        monthPending: Number(r.monthPending),
        monthOrders: r.monthOrders,
      };
    });
    return {
      ...paginated(data, q.page, q.limit, agg?.total ?? 0),
      month: vnMonthKey(now),
      summary: { totalDebt: Number(agg?.totalDebt ?? 0), debtors: agg?.debtors ?? 0 },
    };
  }
}
