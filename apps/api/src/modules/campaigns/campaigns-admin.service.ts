import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Campaign, CampaignAudience, CampaignLinkType, CampaignPlacement, CouponScope } from '@prisma/client';
import { publicImage } from '../../common/public-image';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeCouponCode } from '../coupons/coupons.service';
import { assertWindow, campaignStatus, normalizeLink, slugFromTitle, type CampaignStatus } from './campaign-admin-rules';
import { CAMPAIGN_MAX_COUPONS, CAMPAIGN_MAX_PRODUCTS, type CreateCampaignDto, type UpdateCampaignDto } from './dto/campaign.dto';

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
}

export interface AdminCampaignDetail extends Omit<AdminCampaignRow, 'image' | 'productCount' | 'couponCount'> {
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

function toDetail(c: DetailRow, now: Date): AdminCampaignDetail {
  return {
    ...baseFields(c, now),
    image: c.image,
    products: c.products.map((l) => l.product),
    couponCodes: c.coupons.map((l) => l.coupon.code),
  };
}

const isUniqueViolation = (e: unknown): boolean => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Danh sách tối đa vài mục để báo lỗi gọn khi admin dán nhầm cả trăm mã. */
const named = (items: readonly string[]) => items.slice(0, 5).join(', ');

@Injectable()
export class CampaignsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(placement?: CampaignPlacement, now: Date = new Date()): Promise<AdminCampaignRow[]> {
    const rows = await this.prisma.campaign.findMany({
      where: placement ? { placement } : {},
      orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }, { startAt: 'desc' }, { id: 'asc' }],
      take: LIST_LIMIT,
      include: { _count: { select: { products: true, coupons: true } } },
    });
    return rows.map((c) => ({
      ...baseFields(c, now),
      image: publicImage('campaign', c.id, 'cover', c.image),
      productCount: c._count.products,
      couponCount: c._count.coupons,
    }));
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
          audience: dto.audience ?? 'ALL',
          startAt,
          endAt,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
        include: DETAIL_INCLUDE,
      });
      return toDetail(created, now);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(`Đã có chiến dịch dùng slug "${slug}". Đổi tên hoặc nhập slug khác.`);
      throw e;
    }
  }

  async update(id: string, dto: UpdateCampaignDto, now: Date = new Date()): Promise<AdminCampaignDetail> {
    const current = await this.prisma.campaign.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Không tìm thấy chiến dịch.');

    const startAt = dto.startAt === undefined ? undefined : new Date(dto.startAt);
    const endAt = dto.endAt === undefined ? undefined : new Date(dto.endAt);
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
    }
    const updated = await this.prisma.campaign.update({ where: { id }, data, include: DETAIL_INCLUDE });
    return toDetail(updated, now);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const { count } = await this.prisma.campaign.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Không tìm thấy chiến dịch.');
    return { ok: true };
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Không tìm thấy chiến dịch.');
  }

  /** Thay hết danh sách sản phẩm; thứ tự gửi lên là thứ tự hiển thị. */
  async setProducts(id: string, productIds: readonly string[]): Promise<{ count: number }> {
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
    const clear = this.prisma.campaignProduct.deleteMany({ where: { campaignId: id } });
    const writes = ids.length > 0
      ? [clear, this.prisma.campaignProduct.createMany({ data: ids.map((productId, sortOrder) => ({ campaignId: id, productId, sortOrder })) })]
      : [clear];
    await this.prisma.$transaction(writes);
    return { count: ids.length };
  }

  /** Thay hết mã gắn kèm. Chỉ mã công khai/nhận được, không thuộc lô thẻ in: các mã khác không hiện trên trang nên gắn vào chỉ gây hiểu nhầm. */
  async setCoupons(id: string, rawCodes: readonly string[]): Promise<{ count: number }> {
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

    const clear = this.prisma.campaignCoupon.deleteMany({ where: { campaignId: id } });
    const writes = codes.length > 0
      ? [clear, this.prisma.campaignCoupon.createMany({ data: codes.map((code, sortOrder) => ({ campaignId: id, couponId: byCode.get(code)!.id, sortOrder })) })]
      : [clear];
    await this.prisma.$transaction(writes);
    return { count: codes.length };
  }
}
