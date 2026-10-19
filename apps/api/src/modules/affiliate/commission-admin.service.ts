import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { escapePrismaLike, foldVietnamese } from '../catalog/search-text';
import { loadDefaultRate } from './commission-rate';
import {
  AFFILIATE_MAX_RATE_KEY,
  DEFAULT_AFFILIATE_MAX_RATE_PCT,
  RATE_CSV_MAX_ROWS,
  parseRateCsv,
  rateProblem,
  sanitizeMaxRate,
} from './commission-rate-csv';
import { COMMISSION_ELIGIBLE_ROLES_KEY, DEFAULT_COMMISSION_ELIGIBLE_ROLES, sanitizeEligibleRoles } from './commission-eligibility';

export type RateImportStatus = 'OK' | 'UNCHANGED' | 'NOT_FOUND' | 'INVALID' | 'OVER_CAP' | 'DUPLICATE';

export type RateImportRow = {
  line: number;
  sku: string;
  input: string;
  status: RateImportStatus;
  rate: number | null;
  currentRate: number | null;
  productName: string | null;
  variationName: string | null;
  message: string | null;
};

/** Trạng thái chặn cả lần nhập: giá trị admin muốn đặt không rõ ràng, áp một phần thì CTV hưởng sai mà không ai biết. */
const BLOCKING: ReadonlySet<RateImportStatus> = new Set(['INVALID', 'OVER_CAP', 'DUPLICATE']);

type Db = PrismaService | Prisma.TransactionClient;

const toRate = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));
const toDecimal = (rate: number | null): Prisma.Decimal | null => (rate === null ? null : new Prisma.Decimal(rate));

type LockedRate = { id: string; sku: string; affiliateRate: Prisma.Decimal | null };
type RateChange = { sku: string; from: number | null; to: number | null };
const toChanges = (rows: LockedRate[], to: number | null): RateChange[] => rows.map((v) => ({ sku: v.sku, from: toRate(v.affiliateRate), to }));

/** Cursor "Tải thêm" của danh sách % hoa hồng: (tên, id) sản phẩm cuối trang, base64url JSON — web coi là chuỗi mờ. */
export function encodeListCursor(p: { name: string; id: string }): string {
  return Buffer.from(JSON.stringify([p.name, p.id]), 'utf8').toString('base64url');
}

export function decodeListCursor(cursor: string): { name: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && v[1]) {
      return { name: v[0], id: v[1] };
    }
  } catch {
    // rơi xuống lỗi chung bên dưới
  }
  throw new BadRequestException('Cursor phân trang không hợp lệ — tải lại danh sách.');
}

/** Mỗi dòng log tối đa ngần này thay đổi — lần nhập lớn tách nhiều dòng thay vì một dòng vài trăm KB. */
const LOG_CHUNK = 100;

/**
 * Admin đặt % hoa hồng CTV cho biến thể (D1-01/D3-01). `Variation.affiliateRate` là nguồn duy nhất của % hoa hồng
 * (createCommissionForOrder, order-reversal) mà trước đây không có đường ghi nào, nên mọi đơn CTV với hàng đồng bộ từ Pancake
 * ra 0đ. Đồng bộ Pancake không ghi cột này (pancake-sync.service upsertProduct), nên mức admin đặt không bị ghi đè.
 *
 * Không có bảng nhật ký chung: mọi lần ghi để lại log có id admin cùng giá trị cũ → mới (theo SKU).
 * Biến thể chưa đặt giữ NULL và hưởng mức mặc định `affiliate.default_rate_pct` lúc đặt đơn (commission-rate.ts); hàng đối tác
 * chưa đặt vẫn 0đ.
 */
@Injectable()
export class CommissionAdminService {
  private readonly logger = new Logger(CommissionAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async defaultRate(): Promise<number> {
    return loadDefaultRate(this.config);
  }

  async maxRate(): Promise<number> {
    return sanitizeMaxRate(await this.config.get<unknown>(AFFILIATE_MAX_RATE_KEY, DEFAULT_AFFILIATE_MAX_RATE_PCT));
  }

  private async assertRate(rate: unknown): Promise<number> {
    const problem = rateProblem(rate, await this.maxRate());
    if (problem) throw new BadRequestException(`% hoa hồng ${problem}.`);
    return rate as number;
  }

  /**
   * Sản phẩm kèm biến thể để đặt %, sắp theo (tên, id), phân trang keyset theo đúng cặp đó: cursor mang (tên, id) của sản phẩm
   * cuối trang trước, nên trang sau vẫn đúng khi sản phẩm đó đã rời bộ lọc (vd vừa đặt % khi đang lọc "chưa có %"). Cursor
   * kiểu Prisma `{id}, skip:1` thì khi dòng cursor không còn khớp bộ lọc lại bỏ qua sản phẩm kế tiếp.
   * `missing`: chỉ sản phẩm đang bán còn biến thể đang bán chưa có % (NULL — khác 0 là admin cố ý không trả hoa hồng). Cùng
   * tập với `summary` và với "áp cho chưa có %": sản phẩm đã ngừng bán không bán được nên không tính là thiếu %.
   */
  async listProducts(opts: { q?: string; missing?: boolean; cursor?: string; take: number }) {
    const q = opts.q?.trim();
    const after = opts.cursor ? decodeListCursor(opts.cursor) : null;
    const where: Prisma.ProductWhereInput = {
      ...(after ? { AND: [{ OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] }] } : {}),
      ...(q
        ? {
            OR: [
              { nameSearch: { contains: escapePrismaLike(foldVietnamese(q)) } },
              { variations: { some: { sku: { contains: escapePrismaLike(q), mode: 'insensitive' } } } },
            ],
          }
        : {}),
      ...(opts.missing ? { isActive: true, variations: { some: { isActive: true, affiliateRate: null } } } : {}),
    };
    const [rows, maxRate, defaultRate, missing, missingTubu] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: opts.take + 1,
        select: {
          id: true,
          name: true,
          thumbnail: true,
          brand: true,
          isActive: true,
          affiliateBlocked: true,
          approvalStatus: true,
          storefrontId: true,
          variations: {
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              sku: true,
              name: true,
              retailPrice: true,
              salePrice: true,
              isActive: true,
              affiliateRate: true,
              dealerPrices: true,
            },
          },
        },
      }),
      this.maxRate(),
      this.defaultRate(),
      this.prisma.variation.count({ where: { isActive: true, affiliateRate: null, product: { isActive: true } } }),
      this.prisma.variation.count({ where: { isActive: true, affiliateRate: null, product: { isActive: true, storefrontId: null } } }),
    ]);
    const page = rows.slice(0, opts.take);
    return {
      items: page.map(({ storefrontId, variations, ...p }) => ({
        ...p,
        isPartner: storefrontId !== null,
        variations: variations.map((v) => ({ ...v, affiliateRate: toRate(v.affiliateRate) })),
      })),
      nextCursor: rows.length > opts.take && page.length ? encodeListCursor(page[page.length - 1]!) : null,
      maxRate,
      defaultRate,
      summary: { missing, missingTubu },
    };
  }

  /** Đặt % cho một biến thể (kể cả biến thể đang tắt — bật lại thì đã có %). `rate = null`: xoá % riêng, về mức mặc định. */
  async setVariationRate(adminId: string, variationId: string, rate: number | null) {
    if (rate !== null) await this.assertRate(rate);
    return this.prisma.$transaction(async (tx) => {
      const [before] = await tx.$queryRaw<LockedRate[]>`
        SELECT "id", "sku", "affiliateRate" FROM "variations" WHERE "id" = ${variationId} FOR NO KEY UPDATE`;
      if (!before) throw new NotFoundException('Không tìm thấy biến thể.');
      await tx.variation.update({ where: { id: variationId }, data: { affiliateRate: toDecimal(rate) } });
      this.logRateChanges(adminId, rate === null ? 'xoá % hoa hồng CTV của biến thể (về mặc định)' : 'đặt % hoa hồng CTV cho biến thể', toChanges([before], rate));
      return { id: before.id, sku: before.sku, affiliateRate: rate };
    });
  }

  /** Đặt cùng một % cho mọi biến thể ĐANG BÁN của sản phẩm (biến thể đang tắt giữ nguyên). */
  async setProductRate(adminId: string, productId: string, rate: number | null) {
    if (rate !== null) await this.assertRate(rate);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
      if (!product) throw new NotFoundException('Không tìm thấy sản phẩm.');
      const locked = await tx.$queryRaw<LockedRate[]>`
        SELECT "id", "sku", "affiliateRate" FROM "variations"
        WHERE "productId" = ${productId} AND "isActive" = true
        ORDER BY "id" FOR NO KEY UPDATE`;
      if (locked.length === 0) throw new BadRequestException('Sản phẩm không có biến thể đang bán để đặt %.');
      await tx.variation.updateMany({ where: { id: { in: locked.map((v) => v.id) } }, data: { affiliateRate: toDecimal(rate) } });
      this.logRateChanges(adminId, `${rate === null ? 'xoá % (về mặc định)' : 'đặt %'} hoa hồng CTV cho sản phẩm ${productId} (${product.name})`, toChanges(locked, rate));
      return { productId, updated: locked.length, affiliateRate: rate };
    });
  }

  /**
   * Áp % cho mọi biến thể đang bán CHƯA có % của sản phẩm Tubu đang bán — đúng tập `summary.missingTubu` mà web hỏi xác nhận.
   * Hàng đối tác (gian hàng tự đăng) không áp hàng loạt: hoa hồng CTV Tubu trả, không trừ vào đối soát đối tác, nên đặt từng
   * sản phẩm. Khoá theo id rồi mới ghi: dòng admin khác vừa đặt % song song bị Postgres loại khỏi tập khoá (kiểm lại
   * `affiliateRate IS NULL` trên bản mới), nên không bị ghi đè.
   */
  async fillMissingRates(adminId: string, rate: number) {
    await this.assertRate(rate);
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<LockedRate[]>`
          SELECT v."id", v."sku", v."affiliateRate" FROM "variations" v
          JOIN "products" p ON p."id" = v."productId"
          WHERE v."isActive" = true AND v."affiliateRate" IS NULL AND p."isActive" = true AND p."storefrontId" IS NULL
          ORDER BY v."id" FOR NO KEY UPDATE OF v`;
        if (locked.length) {
          await tx.variation.updateMany({
            where: { id: { in: locked.map((v) => v.id) }, affiliateRate: null },
            data: { affiliateRate: new Prisma.Decimal(rate) },
          });
        }
        this.logRateChanges(adminId, 'áp % hoa hồng CTV cho biến thể đang bán chưa có % (hàng Tubu)', toChanges(locked, rate));
        return { updated: locked.length, affiliateRate: rate };
      },
      { timeout: 30_000 },
    );
  }

  /** Log "sku: cũ→mới" theo lô (một dòng tối đa LOG_CHUNK thay đổi). Gọi trong transaction, ngay trước commit. */
  private logRateChanges(adminId: string, action: string, changes: RateChange[], summary = `đổi ${changes.length} biến thể`) {
    this.logger.log(`Admin ${adminId} ${action}: ${summary}.`);
    for (let i = 0; i < changes.length; i += LOG_CHUNK) {
      const part = changes.slice(i, i + LOG_CHUNK).map((c) => `${c.sku}: ${c.from ?? 'mặc định'}→${c.to ?? 'mặc định'}`);
      this.logger.log(`Admin ${adminId} ${action} (${i + 1}–${i + part.length}/${changes.length}): ${part.join('; ')}`);
    }
  }

  /** Xem trước một lần nhập CSV "sku,%": không ghi gì. */
  async previewImport(csv: string) {
    return this.classify(this.prisma, csv, await this.maxRate());
  }

  /**
   * Áp CSV trong MỘT transaction, phân loại lại trên dữ liệu lúc ghi (không tin bản xem trước). Còn dòng sai định dạng, vượt
   * trần hay SKU lặp → 400, không ghi dòng nào. SKU không khớp thì bỏ qua (không có gì để ghi) và trả lại danh sách.
   */
  async applyImport(adminId: string, csv: string) {
    const maxRate = await this.maxRate();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const preview = await this.classify(tx, csv, maxRate, { lock: true });
        if (!preview.canApply) {
          throw new BadRequestException(
            preview.blocking > 0
              ? `Có ${preview.blocking} dòng lỗi (sai định dạng, vượt trần hoặc SKU lặp) — sửa file rồi xem trước lại. Chưa ghi dòng nào.`
              : 'Không có dòng nào cần đổi.',
          );
        }
        const changes = preview.rows.filter((r) => r.status === 'OK');
        const byRate = new Map<number | null, string[]>();
        for (const r of changes) byRate.set(r.rate, [...(byRate.get(r.rate) ?? []), r.sku]);
        for (const [rate, skus] of byRate) {
          await tx.variation.updateMany({ where: { sku: { in: skus } }, data: { affiliateRate: toDecimal(rate) } });
        }
        this.logRateChanges(
          adminId,
          'nhập CSV % hoa hồng CTV',
          changes.map((r) => ({ sku: r.sku, from: r.currentRate, to: r.rate })),
          `đổi ${changes.length} biến thể, giữ nguyên ${preview.counts.UNCHANGED}, không khớp ${preview.counts.NOT_FOUND}`,
        );
        return { preview, changes };
      },
      { timeout: 30_000 },
    );
    const { preview, changes } = result;
    return {
      updated: changes.length,
      unchanged: preview.counts.UNCHANGED,
      notFound: preview.rows.filter((r) => r.status === 'NOT_FOUND').map((r) => r.sku),
    };
  }

  private async classify(db: Db, csv: string, maxRate: number, opts: { lock?: boolean } = {}) {
    const parsed = parseRateCsv(csv);
    if (parsed.length > RATE_CSV_MAX_ROWS) {
      throw new BadRequestException(`Tối đa ${RATE_CSV_MAX_ROWS} dòng mỗi lần nhập (file có ${parsed.length} dòng) — chia nhỏ file.`);
    }
    const skuCount = new Map<string, number>();
    for (const r of parsed) if (r.sku) skuCount.set(r.sku, (skuCount.get(r.sku) ?? 0) + 1);
    const skus = [...skuCount.keys()];
    // Khoá trước theo thứ tự id: hai lần nhập chồng nhau xếp hàng thay vì deadlock (ghi gom theo mức % nên thứ tự ghi mỗi lần
    // một khác), và mức "cũ" đọc ngay dưới (để log) đúng là mức bị thay.
    if (opts.lock && skus.length) {
      await db.$queryRaw`SELECT "id" FROM "variations" WHERE "sku" = ANY(${skus}) ORDER BY "id" FOR NO KEY UPDATE`;
    }
    const variations = skus.length
      ? await db.variation.findMany({
          where: { sku: { in: skus } },
          select: { sku: true, name: true, affiliateRate: true, product: { select: { name: true } } },
        })
      : [];
    const bySku = new Map(variations.map((v) => [v.sku, v]));

    const rows: RateImportRow[] = parsed.map((p) => {
      const v = bySku.get(p.sku);
      const currentRate = v ? toRate(v.affiliateRate) : null;
      const base = {
        line: p.line,
        sku: p.sku,
        input: p.input,
        rate: p.rate,
        currentRate,
        productName: v?.product.name ?? null,
        variationName: v?.name ?? null,
      };
      if (p.problem) return { ...base, status: 'INVALID' as const, message: p.problem };
      const shape = p.clear ? null : rateProblem(p.rate, Number.POSITIVE_INFINITY);
      if (shape) return { ...base, status: 'INVALID' as const, message: shape };
      const over = p.clear ? null : rateProblem(p.rate, maxRate);
      if (over) return { ...base, status: 'OVER_CAP' as const, message: over };
      if ((skuCount.get(p.sku) ?? 0) > 1) return { ...base, status: 'DUPLICATE' as const, message: 'SKU xuất hiện nhiều lần trong file' };
      if (!v) return { ...base, status: 'NOT_FOUND' as const, message: 'không có biến thể nào mang SKU này' };
      if (currentRate === p.rate) return { ...base, status: 'UNCHANGED' as const, message: null };
      return { ...base, status: 'OK' as const, message: null };
    });

    const counts: Record<RateImportStatus, number> = { OK: 0, UNCHANGED: 0, NOT_FOUND: 0, INVALID: 0, OVER_CAP: 0, DUPLICATE: 0 };
    for (const r of rows) counts[r.status]++;
    const blocking = rows.filter((r) => BLOCKING.has(r.status)).length;
    return { rows, counts, blocking, maxRate, canApply: blocking === 0 && counts.OK > 0 };
  }

  /**
   * Người giới thiệu + hoa hồng của một đơn (D3-07) để admin tra khi CTV hỏi "đơn X có hoa hồng không" (route chỉ ADMIN).
   * `referrer` là người được ghi công trên đơn; hoa hồng có thể thiếu dù có người giới thiệu (hàng chưa có %, bị chặn CTV,
   * hàng ký gửi của chính người giới thiệu, tự giới thiệu, người giới thiệu không phải CTV/đại lý) — `commissions` rỗng trong
   * các trường hợp đó.
   */
  async orderReferral(orderIdOrCode: string) {
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderIdOrCode }, { code: orderIdOrCode }] },
      select: {
        id: true,
        code: true,
        userId: true,
        referrerUserId: true,
        storefrontSlug: true,
        placedForCustomer: true,
        source: true,
        storefront: { select: { id: true, slug: true, title: true, type: true } },
      },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng.');
    const [referrer, commissions, eligibleRoles] = await Promise.all([
      order.referrerUserId
        ? this.prisma.user.findUnique({
            where: { id: order.referrerUserId },
            select: { id: true, fullName: true, phone: true, referralCode: true, role: true },
          })
        : null,
      this.prisma.commission.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          affiliateUserId: true,
          amount: true,
          rate: true,
          commissionableTotal: true,
          status: true,
          createdAt: true,
          lockedAt: true,
          approvedAt: true,
          paidAt: true,
          user: { select: { fullName: true } },
        },
      }),
      this.config.get<unknown>(COMMISSION_ELIGIBLE_ROLES_KEY, DEFAULT_COMMISSION_ELIGIBLE_ROLES).then(sanitizeEligibleRoles),
    ]);
    return {
      orderCode: order.code,
      referrer,
      // Vai trò người giới thiệu (hiện tại) có được hưởng hoa hồng không, kể cả đơn lên hộ khách. null = không có.
      referrerEligible: referrer ? eligibleRoles.has(referrer.role) : null,
      selfReferral: !!order.referrerUserId && order.referrerUserId === order.userId && !order.placedForCustomer,
      placedForCustomer: order.placedForCustomer,
      source: order.source,
      storefront: order.storefront,
      storefrontSlug: order.storefrontSlug,
      commissions: commissions.map(({ user, rate, ...c }) => ({ ...c, rate: Number(rate), affiliateName: user.fullName })),
    };
  }
}
