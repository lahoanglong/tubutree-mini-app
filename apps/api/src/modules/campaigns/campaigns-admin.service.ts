import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Campaign, CampaignAudience, CampaignLinkType, CampaignPlacement, CouponScope } from '@prisma/client';
import { publicImage } from '../../common/public-image';
import { PRISMA_TRANSACTION_OPTIONS, PrismaService } from '../../prisma/prisma.service';
import { ImageRegistryStale } from '../catalog/image-registry-stale';
import { normalizeCouponCode } from '../coupons/coupons.service';
import { assertWindow, campaignStatus, normalizeLink, slugFromTitle, type CampaignStatus } from './campaign-admin-rules';
import { countHealth, type HealthIssue, type HealthSubject } from './campaign-health';
import { campaignHealthBatch, campaignHealthDetailBatch } from './campaign-health-loader';
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
  /** Số món khách dùng được trên trang chiến dịch theo danh sách đang soạn (form chọn thứ tự gắn từ đây). */
  usable: { products: number; coupons: number };
  blockers: number;
  warnings: number;
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
    if (String(e.meta?.field_name ?? '').includes('campaignId')) throw new NotFoundException('Không tìm thấy chiến dịch.');
    throw new BadRequestException(`${what} vừa bị xoá, tải lại danh sách rồi chọn lại.`);
  }
  throw e;
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

  /** Kiểm một chiến dịch chưa lưu (hoặc đang sửa) như thể đã bật. Không ghi gì. */
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
    // Chiến dịch mới chưa có liên kết trong DB: không gửi danh sách nghĩa là danh sách rỗng. Sửa chiến dịch đã lưu mà không gửi thì dùng liên kết đang lưu.
    const fresh = dto.id === undefined;
    const productIds = dto.productIds ?? (fresh ? [] : undefined);
    const couponCodes = dto.couponCodes ?? (fresh ? [] : undefined);
    const [detail] = await campaignHealthDetailBatch(this.prisma, [{ subject, ...(productIds ? { productIds } : {}), ...(couponCodes ? { couponCodes } : {}) }], now);
    const issues = detail?.issues ?? [];
    return { issues, usable: detail?.usable ?? { products: 0, coupons: 0 }, ...countHealth(issues) };
  }

  /** Bật chiến dịch mà còn lỗi chặn thì 400 với câu đầu tiên. Kiểm lại ngay trong request, không tin gì từ trình duyệt. */
  private async assertCanActivate(client: Prisma.TransactionClient | PrismaService, subject: HealthSubject, now: Date): Promise<void> {
    const [issues = []] = await campaignHealthBatch(client, [{ subject, ...(subject.id ? {} : { productIds: [], couponCodes: [] }) }], now);
    const block = issues.find((i) => i.level === 'BLOCK');
    if (block) throw new BadRequestException(block.message);
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
    if (isActive && endAt > now) await this.assertCanActivate(this.prisma, { placement: dto.placement, audience, linkType, linkValue, startAt, endAt, sortOrder }, now);
    const slug = dto.slug ?? slugFromTitle(dto.title);
    if (await this.prisma.campaign.findUnique({ where: { slug }, select: { id: true } })) {
      throw new ConflictException(`Đã có chiến dịch dùng slug "${slug}". Đổi tên hoặc nhập slug khác.`);
    }
    try {
      const created = await this.prisma.campaign.create({
        data: {
          slug,
          title: dto.title,
          subtitle: dto.subtitle?.trim() || null,
          placement: dto.placement,
          image: dto.image,
          linkType,
          linkValue,
          audience,
          startAt,
          endAt,
          sortOrder,
          isActive,
        },
        include: DETAIL_INCLUDE,
      });
      // Ảnh banner https chỉ đổi cỡ được khi có trong danh sách của /img: nạp lại ngay thay vì đợi 5 phút.
      this.imageStale?.markStale();
      return toDetail(created, now);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(`Đã có chiến dịch dùng slug "${slug}". Đổi tên hoặc nhập slug khác.`);
      throw e;
    }
  }

  async update(id: string, dto: UpdateCampaignDto, now: Date = new Date()): Promise<AdminCampaignDetail> {
    const startAt = dto.startAt === undefined ? undefined : new Date(dto.startAt);
    const endAt = dto.endAt === undefined ? undefined : new Date(dto.endAt);

    // Đọc, kiểm và ghi cùng một giao dịch sau khi khoá dòng: PUT sản phẩm/mã cùng khoá dòng này nên không chen vào giữa lúc kiểm và lúc ghi.
    const { updated, current } = await this.prisma.$transaction(async (tx) => {
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
      let linkChanged = false;
      if (dto.linkType !== undefined || dto.linkValue !== undefined) {
        const linkType = dto.linkType ?? current.linkType;
        data.linkType = linkType;
        data.linkValue = normalizeLink(linkType, dto.linkValue !== undefined ? dto.linkValue : current.linkValue);
        // Lưu lại đúng đích cũ không kiểm lại: sản phẩm đã ẩn không được chặn việc sửa tiêu đề hay giờ của banner.
        linkChanged = linkType !== current.linkType || data.linkValue !== current.linkValue;
        if (linkChanged) await this.assertLinkTarget(tx, linkType, data.linkValue);
      }

      // "Bật" là mọi bước đưa chiến dịch từ khách-không-thấy sang khách-thấy: đang tắt hoặc đã quá endAt trước đó, và sau khi ghi thì bật và chưa hết hạn.
      // Đổi đích lúc đang chạy cũng kiểm. Lỗi cũ không chặn việc sửa tiêu đề hay giờ của chiến dịch đang chạy.
      const merged = {
        placement: dto.placement ?? current.placement,
        audience: dto.audience ?? current.audience,
        linkType: data.linkType === undefined ? current.linkType : (data.linkType as CampaignLinkType),
        linkValue: data.linkValue === undefined ? current.linkValue : (data.linkValue as string | null),
        startAt: startAt ?? current.startAt,
        endAt: endAt ?? current.endAt,
        sortOrder: dto.sortOrder ?? current.sortOrder,
      };
      const wasVisible = current.isActive && current.endAt > now;
      const willBeVisible = (dto.isActive ?? current.isActive) && merged.endAt > now;
      if (willBeVisible && (!wasVisible || linkChanged)) await this.assertCanActivate(tx, { id, ...merged }, now);

      const updated = await tx.campaign.update({ where: { id }, data, include: DETAIL_INCLUDE });
      return { updated, current };
    }, PRISMA_TRANSACTION_OPTIONS);
    if (dto.image !== undefined && dto.image !== current.image) this.imageStale?.markStale();
    return toDetail(updated, now);
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

  /**
   * Việc đầu của mỗi giao dịch "xoá hết rồi ghi lại": hai người thay danh sách cùng lúc thì người sau chờ ở đây tới khi người trước xong.
   * Thiếu khoá thì cả hai cùng xoá một danh sách cũ rồi cùng ghi, và chiến dịch giữ lẫn sản phẩm của hai bên.
   */
  private lockRow(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, id: string) {
    return tx.$queryRaw`SELECT "id" FROM "campaigns" WHERE "id" = ${id} FOR UPDATE`;
  }

  /**
   * Gọi trong giao dịch, SAU khi đã ghi danh sách mới và trước khi commit: trang chiến dịch đang bật (chưa kết thúc) mà sau lần ghi này không còn
   * sản phẩm hiển thị nào và không còn mã dùng được thì ném 400, giao dịch huỷ nên không ghi gì. Chiến dịch tắt hay đã kết thúc thì cho.
   */
  private async assertPageNotEmptied(tx: Prisma.TransactionClient, id: string, now: Date): Promise<void> {
    const c = await tx.campaign.findUnique({ where: { id } });
    if (!c || !c.isActive || c.endAt <= now || c.linkType !== 'CAMPAIGN_PAGE') return;
    const [issues = []] = await campaignHealthBatch(tx, [{ subject: subjectOf(c) }], now);
    const empty = issues.find((i) => i.code === 'PAGE_EMPTY');
    if (empty) throw new BadRequestException(empty.message);
  }

  /** Thay hết danh sách sản phẩm; thứ tự gửi lên là thứ tự hiển thị. */
  async setProducts(id: string, productIds: readonly string[], now: Date = new Date()): Promise<{ count: number }> {
    if (productIds.length > CAMPAIGN_MAX_PRODUCTS) {
      throw new BadRequestException(`Mỗi chiến dịch tối đa ${CAMPAIGN_MAX_PRODUCTS} sản phẩm.`);
    }
    await this.assertExists(id);
    const ids = [...new Set(productIds)];
    if (ids.length > 0) {
      const found = new Set((await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((p) => p.id));
      const unknown = ids.filter((v) => !found.has(v));
      if (unknown.length > 0) throw new BadRequestException(`Không tìm thấy sản phẩm: ${named(unknown)}.`);
    }
    await this.prisma
      .$transaction(async (tx) => {
        await this.lockRow(tx, id);
        await tx.campaignProduct.deleteMany({ where: { campaignId: id } });
        if (ids.length > 0) await tx.campaignProduct.createMany({ data: ids.map((productId, sortOrder) => ({ campaignId: id, productId, sortOrder })) });
        await this.assertPageNotEmptied(tx, id, now);
      })
      .catch((e: unknown) => rethrowForeignKey(e, 'Có sản phẩm'));
    return { count: ids.length };
  }

  /** Thay hết mã gắn kèm. Chỉ mã công khai/nhận được, không thuộc lô thẻ in: các mã khác không hiện trên trang nên gắn vào chỉ gây hiểu nhầm. */
  async setCoupons(id: string, rawCodes: readonly string[], now: Date = new Date()): Promise<{ count: number }> {
    if (rawCodes.length > CAMPAIGN_MAX_COUPONS) {
      throw new BadRequestException(`Mỗi chiến dịch gắn tối đa ${CAMPAIGN_MAX_COUPONS} mã.`);
    }
    await this.assertExists(id);
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

    await this.prisma
      .$transaction(async (tx) => {
        await this.lockRow(tx, id);
        await tx.campaignCoupon.deleteMany({ where: { campaignId: id } });
        if (codes.length > 0) await tx.campaignCoupon.createMany({ data: codes.map((code, sortOrder) => ({ campaignId: id, couponId: byCode.get(code)!.id, sortOrder })) });
        await this.assertPageNotEmptied(tx, id, now);
      })
      .catch((e: unknown) => rethrowForeignKey(e, 'Có mã'));
    return { count: codes.length };
  }
}
