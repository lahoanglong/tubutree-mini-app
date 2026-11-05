import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Campaign, CampaignAudience, CampaignLinkType, CampaignPlacement, CouponScope } from '@prisma/client';
import { isLockBusy, isLockContention, throwIfLockBusy } from '../../common/lock-busy';
import { publicImage } from '../../common/public-image';
import { PRISMA_TRANSACTION_OPTIONS, PrismaService } from '../../prisma/prisma.service';
import { ImageRegistryStale } from '../catalog/image-registry-stale';
import { normalizeCouponCode } from '../coupons/coupons.service';
import { assertWindow, campaignStatus, normalizeLink, slugFromTitle, type CampaignStatus } from './campaign-admin-rules';
import { campaignPhase, countHealth, needsCleanSlate, saveVerdict, type HealthIssue, type HealthSubject, type SaveVerdict, type VerdictState } from './campaign-health';
import { campaignHealthBatch } from './campaign-health-loader';
import { CAMPAIGN_MAX_COUPONS, CAMPAIGN_MAX_PRODUCTS, type CheckCampaignDto, type CreateCampaignDto, type UpdateCampaignDto } from './dto/campaign.dto';

export interface AdminCampaignRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  placement: CampaignPlacement;
  /** Tham chiếu công khai: ảnh base64 không nhúng vào danh sách. */
  image: string | null;
  linkType: CampaignLinkType;
  linkValue: string | null;
  audience: CampaignAudience;
  startAt: string;
  endAt: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  couponCount: number;
  status: CampaignStatus;
  /** Kết quả kiểm trước khi bật (xem campaign-health.ts), tính như chiến dịch đang bật. */
  health: { blockers: number; warnings: number };
}

export interface CampaignCheckResult {
  issues: HealthIssue[];
  blockers: number;
  warnings: number;
  /** Phán quyết của lần lưu này theo ĐÚNG luật `saveVerdict` mà tạo/sửa/PUT dùng (before là bản đã lưu khi có id, không hiện khi tạo mới). */
  verdict: { blocked: boolean; codes: string[]; reason?: string };
}

export interface AdminCampaignDetail extends Omit<AdminCampaignRow, 'image' | 'productCount' | 'couponCount' | 'health'> {
  /** Ảnh nguyên bản (URL https hoặc base64) để form sửa gửi lại đúng giá trị. */
  image: string;
  products: { id: string; name: string; slug: string }[];
  couponCodes: string[];
}

// Chỉ hai loại mã này được lên trang công khai (xem couponShown ở campaigns.service); gắn loại khác sẽ lặng lẽ không hiện.
const ATTACHABLE_SCOPES: readonly CouponScope[] = ['PUBLIC', 'CLAIM'];
const LIST_LIMIT = 200;

const DETAIL_INCLUDE = {
  products: { orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }], include: { product: { select: { id: true, name: true, slug: true } } } },
  coupons: { orderBy: [{ sortOrder: 'asc' }, { couponId: 'asc' }], include: { coupon: { select: { code: true } } } },
} satisfies Prisma.CampaignInclude;

type DetailRow = Prisma.CampaignGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** Mã đã tra: danh sách chuẩn hoá bỏ trùng theo thứ tự, và id của từng mã. */
interface ResolvedCoupons {
  codes: string[];
  ids: Map<string, string>;
}

function baseFields(c: Campaign, now: Date) {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    subtitle: c.subtitle,
    placement: c.placement,
    linkType: c.linkType,
    linkValue: c.linkValue,
    audience: c.audience,
    startAt: c.startAt.toISOString(),
    endAt: c.endAt.toISOString(),
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    status: campaignStatus(c, now),
  };
}

function subjectOf(c: Pick<Campaign, 'id' | 'placement' | 'audience' | 'linkType' | 'linkValue' | 'startAt' | 'endAt' | 'sortOrder'>): HealthSubject {
  return { id: c.id, placement: c.placement, audience: c.audience, linkType: c.linkType, linkValue: c.linkValue, startAt: c.startAt, endAt: c.endAt, sortOrder: c.sortOrder };
}

function toDetail(c: DetailRow, now: Date): AdminCampaignDetail {
  return {
    ...baseFields(c, now),
    image: c.image,
    products: c.products.map((l) => l.product),
    couponCodes: c.coupons.map((l) => l.coupon.code),
  };
}

const isUniqueViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Kiểm tồn tại chạy ngoài giao dịch nên sản phẩm/mã/chiến dịch bị xoá giữa chừng làm createMany vỡ khoá ngoại (P2003): chiến dịch mất thì
 * 404, còn lại là mục vừa bị xoá nên 400 để admin tải lại danh sách thay vì 500.
 */
function rethrowForeignKey(e: unknown, what: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
    const field = String(e.meta?.field_name ?? '');
    if (field.includes('campaignId')) throw new NotFoundException('Không tìm thấy chiến dịch.');
    const label = field.includes('couponId') ? 'Có mã' : field.includes('productId') ? 'Có sản phẩm' : what;
    throw new BadRequestException(`${label} vừa bị xoá, tải lại danh sách rồi chọn lại.`);
  }
  throw e;
}

/**
 * Hạn chờ khoá trong giao dịch lưu chiến dịch, nhỏ hơn hạn giao dịch (5 giây của `PRISMA_TRANSACTION_OPTIONS`): giữ khoá lâu hơn thế thì Postgres tự huỷ câu đang chờ
 * (55P03) và lệnh lưu báo 409, thay vì chờ tới khi Prisma huỷ giao dịch (P2028 rồi 503).
 */
const CAMPAIGN_LOCK_TIMEOUT = '3s';
const SAVE_BUSY_MESSAGE = 'Chiến dịch đang được người khác lưu, thử lại sau giây lát';

/**
 * Lỗi của giao dịch lưu. Chỉ tranh khoá thật (55P03, 40P01, P2034) là 409 tiếng Việt: người khác đang lưu, thử lại là qua, giao dịch đã huỷ nên không ghi gì.
 * Hết hạn giao dịch (P2028) và statement timeout (57014) đi đường chung của dự án (503 và LOCK_BUSY_MESSAGE, có lên Sentry) như mọi nơi khác.
 */
function rethrowSaveFailure(e: unknown, what: string): never {
  if (isLockContention(e)) throw new ConflictException(SAVE_BUSY_MESSAGE);
  if (isLockBusy(e)) throwIfLockBusy(e);
  return rethrowForeignKey(e, what);
}

/** Danh sách tối đa vài mục để báo lỗi gọn khi admin dán nhầm cả trăm mã. */
const named = (items: readonly string[]) => items.slice(0, 5).join(', ');

@Injectable()
export class CampaignsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ImageRegistryStale) private readonly imageStale?: ImageRegistryStale,
  ) {}

  async list(placement?: CampaignPlacement, now: Date = new Date()): Promise<AdminCampaignRow[]> {
    const rows = await this.prisma.campaign.findMany({
      where: placement ? { placement } : {},
      orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }, { startAt: 'desc' }, { id: 'asc' }],
      take: LIST_LIMIT,
      include: { _count: { select: { products: true, coupons: true } } },
    });
    const health = await campaignHealthBatch(this.prisma, rows.map((c) => ({ subject: subjectOf(c) })), now);
    return rows.map((c, i) => ({
      ...baseFields(c, now),
      image: publicImage('campaign', c.id, 'cover', c.image),
      productCount: c._count.products,
      couponCount: c._count.coupons,
      // Chiến dịch đã kết thúc không phải sự cố của danh sách: ENDED chỉ báo ở form (check) khi admin đang đặt ngày.
      health: countHealth((health[i] ?? []).filter((x) => x.code !== 'ENDED')),
    }));
  }

  /** Kiểm một chiến dịch chưa lưu (hoặc đang sửa) như thể đã bật, và cho biết lần lưu này có bị chặn không. Không ghi gì. */
  async check(dto: CheckCampaignDto, now: Date = new Date()): Promise<CampaignCheckResult> {
    const linkType = dto.linkType ?? 'CAMPAIGN_PAGE';
    const subject: HealthSubject = {
      ...(dto.id ? { id: dto.id } : {}),
      placement: dto.placement,
      audience: dto.audience ?? 'ALL',
      linkType,
      linkValue: normalizeLink(linkType, dto.linkValue),
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
      sortOrder: dto.sortOrder ?? 0,
    };
    const before = dto.id ? await this.prisma.campaign.findUnique({ where: { id: dto.id } }) : null;
    // Cùng bước kiểm đầu vào như lúc lưu (chỉ đọc): lỗi 400 của chúng thành verdict chặn kèm đúng câu lúc lưu.
    let products: string[] | undefined;
    let coupons: ResolvedCoupons | undefined;
    try {
      if (!before || subject.linkType !== before.linkType || subject.linkValue !== before.linkValue) await this.assertLinkTarget(this.prisma, subject.linkType, subject.linkValue);
      products = dto.productIds ? await this.resolveProductIds(dto.productIds) : undefined;
      coupons = dto.couponCodes ? await this.resolveCoupons(dto.couponCodes) : undefined;
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
      const reason = e.message;
      return { issues: [{ level: 'BLOCK', code: 'INVALID', message: reason }], blockers: 1, warnings: 0, verdict: { blocked: true, codes: ['INVALID'], reason } };
    }
    const { verdict, issues } = await this.judge(this.prisma, before, { ...subject, isActive: dto.isActive ?? true }, { productIds: products, couponCodes: coupons?.codes }, now, true);
    return { issues, ...countHealth(issues), verdict: { blocked: verdict.blocked, codes: verdict.codes, ...(verdict.reason ? { reason: verdict.reason } : {}) } };
  }

  /**
   * Phán quyết MỘT lần cho mọi đường lưu, trước khi ghi (trong khoá dòng của giao dịch gọi). Health "sau" tính với danh sách sẽ được ghi (đúng trạng thái sau lưu);
   * health "trước" chỉ tính khi cần (chiến dịch đang hiện và không đổi đích). Chiến dịch lưu xong vẫn không hiện cho khách thì khỏi tính gì, trừ khi `always` (check cần issues).
   */
  private async judge(
    client: Prisma.TransactionClient | PrismaService,
    before: Campaign | null,
    after: HealthSubject & { isActive: boolean },
    lists: { productIds?: readonly string[] | undefined; couponCodes?: readonly string[] | undefined },
    now: Date,
    always = false,
  ): Promise<{ verdict: SaveVerdict; issues: HealthIssue[] }> {
    const visible = after.isActive && after.endAt > now;
    if (!visible && !always) return { verdict: { blocked: false, codes: [] }, issues: [] };
    const fresh = after.id === undefined;
    const [issues = []] = await campaignHealthBatch(
      client,
      [
        {
          subject: after,
          ...(lists.productIds ? { productIds: [...lists.productIds] } : fresh ? { productIds: [] } : {}),
          ...(lists.couponCodes ? { couponCodes: [...lists.couponCodes] } : fresh ? { couponCodes: [] } : {}),
        },
      ],
      now,
    );
    const stateOf = (c: { isActive: boolean; startAt: Date; endAt: Date; linkType: CampaignLinkType; linkValue: string | null }): VerdictState => ({
      isActive: c.isActive,
      startAt: c.startAt,
      endAt: c.endAt,
      linkType: c.linkType,
      linkValue: c.linkValue,
    });
    const beforeState = before ? stateOf(before) : null;
    const afterState = stateOf(after);
    const needBaseline = before !== null && beforeState !== null && campaignPhase(afterState, now) !== 'OFF' && !needsCleanSlate(beforeState, afterState, now);
    const healthBefore = before && needBaseline ? ((await campaignHealthBatch(client, [{ subject: subjectOf(before) }], now))[0] ?? []) : [];
    const verdict = saveVerdict({ before: beforeState, after: afterState, healthBefore, healthAfter: issues, now });
    return { verdict, issues };
  }

  async get(id: string, now: Date = new Date()): Promise<AdminCampaignDetail> {
    const row = await this.prisma.campaign.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!row) throw new NotFoundException('Không tìm thấy chiến dịch.');
    return toDetail(row, now);
  }

  async create(dto: CreateCampaignDto, now: Date = new Date()): Promise<AdminCampaignDetail> {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    assertWindow(startAt, endAt);
    const linkType = dto.linkType ?? 'CAMPAIGN_PAGE';
    const linkValue = normalizeLink(linkType, dto.linkValue);
    await this.assertLinkTarget(this.prisma, linkType, linkValue);
    const isActive = dto.isActive ?? true;
    const audience = dto.audience ?? 'ALL';
    const sortOrder = dto.sortOrder ?? 0;
    const slug = dto.slug ?? slugFromTitle(dto.title);
    if (await this.prisma.campaign.findUnique({ where: { slug }, select: { id: true } })) {
      throw new ConflictException(`Đã có chiến dịch dùng slug "${slug}". Đổi tên hoặc nhập slug khác.`);
    }
    const products = dto.productIds ? await this.resolveProductIds(dto.productIds) : undefined;
    const coupons = dto.couponCodes ? await this.resolveCoupons(dto.couponCodes) : undefined;
    try {
      const created = await this.prisma
        .$transaction(async (tx) => {
          await this.limitLockWait(tx);
          // Cùng luật với mọi đường lưu: chiến dịch mới hiện cho khách thì không được còn lỗi chặn; vi phạm thì không ghi gì (chưa ghi dòng nào).
          const { verdict } = await this.judge(tx, null, { placement: dto.placement, audience, linkType, linkValue, startAt, endAt, sortOrder, isActive }, { productIds: products, couponCodes: coupons?.codes }, now);
          if (verdict.blocked) throw new BadRequestException(verdict.reason);
          const row = await tx.campaign.create({
            data: { slug, title: dto.title, subtitle: dto.subtitle?.trim() || null, placement: dto.placement, image: dto.image, linkType, linkValue, audience, startAt, endAt, sortOrder, isActive },
            include: DETAIL_INCLUDE,
          });
          if (products) await this.writeProducts(tx, row.id, products);
          if (coupons) await this.writeCoupons(tx, row.id, coupons);
          return products?.length || coupons?.codes.length ? ((await tx.campaign.findUnique({ where: { id: row.id }, include: DETAIL_INCLUDE })) ?? row) : row;
        }, PRISMA_TRANSACTION_OPTIONS)
        .catch((e: unknown) => rethrowSaveFailure(e, 'Có sản phẩm hoặc mã'));
      // Ảnh banner https chỉ đổi cỡ được khi có trong danh sách của /img: nạp lại ngay thay vì đợi 5 phút.
      this.imageStale?.markStale();
      return toDetail(created, now);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(`Đã có chiến dịch dùng slug "${slug}". Đổi tên hoặc nhập slug khác.`);
      throw e;
    }
  }

  async update(id: string, dto: UpdateCampaignDto, now: Date = new Date()): Promise<AdminCampaignDetail> {
    const products = dto.productIds ? await this.resolveProductIds(dto.productIds) : undefined;
    const coupons = dto.couponCodes ? await this.resolveCoupons(dto.couponCodes) : undefined;
    const { updated, current } = await this.commit(id, dto, { products, coupons }, now, true);
    if (dto.image !== undefined && dto.image !== current.image) this.imageStale?.markStale();
    return toDetail(updated!, now);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const { count } = await this.prisma.campaign.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Không tìm thấy chiến dịch.');
    return { ok: true };
  }

  /** Banner kiểu sản phẩm/danh mục phải trỏ tới slug có thật. Chỉ kiểm tồn tại, không bắt sản phẩm đang bán: admin đặt banner trước cho hàng ra mắt chưa bật. */
  private async assertLinkTarget(client: Pick<Prisma.TransactionClient, 'product' | 'category'> | PrismaService, linkType: CampaignLinkType, value: string | null): Promise<void> {
    if (!value) return;
    if (linkType === 'PRODUCT') {
      const found = await client.product.findFirst({ where: { slug: value }, select: { id: true } });
      if (!found) throw new BadRequestException(`Không có sản phẩm với slug "${value}". Kiểm lại slug.`);
    } else if (linkType === 'CATEGORY') {
      const found = await client.category.findUnique({ where: { slug: value }, select: { id: true } });
      if (!found) throw new BadRequestException(`Không có danh mục với slug "${value}". Kiểm lại slug danh mục.`);
    }
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Không tìm thấy chiến dịch.');
  }

  /** Việc đầu của mọi giao dịch lưu: đặt hạn chờ khoá chỉ cho giao dịch này (set_config local). */
  private limitLockWait(tx: Pick<Prisma.TransactionClient, '$executeRaw'>) {
    return tx.$executeRaw`SELECT set_config('lock_timeout', ${CAMPAIGN_LOCK_TIMEOUT}, true)`;
  }

  /**
   * Việc đầu của mỗi giao dịch "xoá hết rồi ghi lại": hai người thay danh sách cùng lúc thì người sau chờ ở đây tới khi người trước xong.
   * Thiếu khoá thì cả hai cùng xoá một danh sách cũ rồi cùng ghi, và chiến dịch giữ lẫn sản phẩm của hai bên.
   */
  private lockRow(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, id: string) {
    return tx.$queryRaw`SELECT "id" FROM "campaigns" WHERE "id" = ${id} FOR UPDATE`;
  }

  /**
   * Một lệnh lưu = MỘT giao dịch: khoá dòng, đọc trước, phán quyết (`judge`), rồi ghi trường và thay danh sách. Phán quyết chặn thì ném 400 trước khi ghi nên không ghi gì.
   * `writeRow` false khi chỉ thay danh sách (PUT sản phẩm/mã giữ cho web cũ): không đụng dòng chiến dịch.
   */
  private async commit(
    id: string,
    dto: UpdateCampaignDto,
    lists: { products: string[] | undefined; coupons: ResolvedCoupons | undefined },
    now: Date,
    writeRow: boolean,
  ): Promise<{ updated: DetailRow | null; current: Campaign }> {
    const startAt = dto.startAt === undefined ? undefined : new Date(dto.startAt);
    const endAt = dto.endAt === undefined ? undefined : new Date(dto.endAt);
    return this.prisma
      .$transaction(async (tx) => {
        await this.limitLockWait(tx);
        await this.lockRow(tx, id);
        const current = await tx.campaign.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Không tìm thấy chiến dịch.');
        if (startAt || endAt) assertWindow(startAt ?? current.startAt, endAt ?? current.endAt);

        const data: Prisma.CampaignUpdateInput = {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.subtitle !== undefined ? { subtitle: dto.subtitle?.trim() || null } : {}),
          ...(dto.placement !== undefined ? { placement: dto.placement } : {}),
          ...(dto.image !== undefined ? { image: dto.image } : {}),
          ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
          ...(startAt ? { startAt } : {}),
          ...(endAt ? { endAt } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        };
        if (dto.linkType !== undefined || dto.linkValue !== undefined) {
          const linkType = dto.linkType ?? current.linkType;
          data.linkType = linkType;
          data.linkValue = normalizeLink(linkType, dto.linkValue !== undefined ? dto.linkValue : current.linkValue);
          // Lưu lại đúng đích cũ không kiểm lại: sản phẩm đã ẩn không được chặn việc sửa tiêu đề hay giờ của banner.
          if (linkType !== current.linkType || data.linkValue !== current.linkValue) await this.assertLinkTarget(tx, linkType, data.linkValue);
        }

        const merged = {
          placement: dto.placement ?? current.placement,
          audience: dto.audience ?? current.audience,
          linkType: data.linkType === undefined ? current.linkType : (data.linkType as CampaignLinkType),
          linkValue: data.linkValue === undefined ? current.linkValue : (data.linkValue as string | null),
          startAt: startAt ?? current.startAt,
          endAt: endAt ?? current.endAt,
          sortOrder: dto.sortOrder ?? current.sortOrder,
        };
        const { verdict } = await this.judge(tx, current, { id, ...merged, isActive: dto.isActive ?? current.isActive }, { productIds: lists.products, couponCodes: lists.coupons?.codes }, now);
        if (verdict.blocked) throw new BadRequestException(verdict.reason);

        let updated = writeRow ? await tx.campaign.update({ where: { id }, data, include: DETAIL_INCLUDE }) : null;
        if (lists.products) await this.writeProducts(tx, id, lists.products);
        if (lists.coupons) await this.writeCoupons(tx, id, lists.coupons);
        if (writeRow && (lists.products || lists.coupons)) updated = (await tx.campaign.findUnique({ where: { id }, include: DETAIL_INCLUDE })) ?? updated;
        return { updated, current };
      }, PRISMA_TRANSACTION_OPTIONS)
      .catch((e: unknown) => rethrowSaveFailure(e, lists.products && lists.coupons ? 'Có sản phẩm hoặc mã' : lists.products ? 'Có sản phẩm' : 'Có mã'));
  }

  /** Kiểm tồn tại và trần số lượng trước giao dịch; trả danh sách đã bỏ trùng. */
  private async resolveProductIds(productIds: readonly string[]): Promise<string[]> {
    if (productIds.length > CAMPAIGN_MAX_PRODUCTS) throw new BadRequestException(`Mỗi chiến dịch tối đa ${CAMPAIGN_MAX_PRODUCTS} sản phẩm.`);
    const ids = [...new Set(productIds)];
    if (ids.length > 0) {
      const found = new Set((await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((p) => p.id));
      const unknown = ids.filter((v) => !found.has(v));
      if (unknown.length > 0) throw new BadRequestException(`Không tìm thấy sản phẩm: ${named(unknown)}.`);
    }
    return ids;
  }

  /** Chỉ mã công khai/nhận được, không thuộc lô thẻ in: các mã khác không hiện trên trang nên gắn vào chỉ gây hiểu nhầm. */
  private async resolveCoupons(rawCodes: readonly string[]): Promise<ResolvedCoupons> {
    if (rawCodes.length > CAMPAIGN_MAX_COUPONS) throw new BadRequestException(`Mỗi chiến dịch gắn tối đa ${CAMPAIGN_MAX_COUPONS} mã.`);
    const codes = [...new Set(rawCodes.map(normalizeCouponCode).filter((c) => c !== ''))];
    const byCode = new Map<string, { id: string; code: string; scope: CouponScope; batch: string | null }>();
    if (codes.length > 0) {
      for (const c of await this.prisma.coupon.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, scope: true, batch: true } })) byCode.set(c.code, c);
    }
    const unknown = codes.filter((c) => !byCode.has(c));
    if (unknown.length > 0) throw new BadRequestException(`Không tìm thấy mã: ${named(unknown)}.`);
    const batched = codes.filter((c) => byCode.get(c)?.batch != null);
    if (batched.length > 0) throw new BadRequestException(`Mã thuộc lô thẻ in, không gắn vào chiến dịch: ${named(batched)}.`);
    const wrongScope = codes.filter((c) => !ATTACHABLE_SCOPES.includes(byCode.get(c)!.scope));
    if (wrongScope.length > 0) throw new BadRequestException(`Mã dành riêng cho người nhận (hạng, nhóm, sinh nhật, mời), không gắn được: ${named(wrongScope)}.`);
    return { codes, ids: new Map(codes.map((c) => [c, byCode.get(c)!.id])) };
  }

  private async writeProducts(tx: Prisma.TransactionClient, id: string, ids: readonly string[]): Promise<void> {
    await tx.campaignProduct.deleteMany({ where: { campaignId: id } });
    if (ids.length > 0) await tx.campaignProduct.createMany({ data: ids.map((productId, sortOrder) => ({ campaignId: id, productId, sortOrder })) });
  }

  private async writeCoupons(tx: Prisma.TransactionClient, id: string, c: ResolvedCoupons): Promise<void> {
    await tx.campaignCoupon.deleteMany({ where: { campaignId: id } });
    if (c.codes.length > 0) await tx.campaignCoupon.createMany({ data: c.codes.map((code, sortOrder) => ({ campaignId: id, couponId: c.ids.get(code)!, sortOrder })) });
  }

  /** Thay hết danh sách sản phẩm (PUT giữ cho web cũ); thứ tự gửi lên là thứ tự hiển thị. Cùng phán quyết với PATCH. */
  async setProducts(id: string, productIds: readonly string[], now: Date = new Date()): Promise<{ count: number }> {
    if (productIds.length > CAMPAIGN_MAX_PRODUCTS) throw new BadRequestException(`Mỗi chiến dịch tối đa ${CAMPAIGN_MAX_PRODUCTS} sản phẩm.`);
    await this.assertExists(id);
    const ids = await this.resolveProductIds(productIds);
    await this.commit(id, {}, { products: ids, coupons: undefined }, now, false);
    return { count: ids.length };
  }

  /** Thay hết mã gắn kèm (PUT giữ cho web cũ). Cùng phán quyết với PATCH. */
  async setCoupons(id: string, rawCodes: readonly string[], now: Date = new Date()): Promise<{ count: number }> {
    if (rawCodes.length > CAMPAIGN_MAX_COUPONS) throw new BadRequestException(`Mỗi chiến dịch gắn tối đa ${CAMPAIGN_MAX_COUPONS} mã.`);
    await this.assertExists(id);
    const coupons = await this.resolveCoupons(rawCodes);
    await this.commit(id, {}, { products: undefined, coupons }, now, false);
    return { count: coupons.codes.length };
  }
}
