import { Injectable, NotFoundException } from '@nestjs/common';
import type { CampaignPlacement, CouponScope, CouponType } from '@prisma/client';
import { paginated } from '../../common/pagination';
import { publicImage } from '../../common/public-image';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { PUBLIC_PRODUCT_WHERE } from '../catalog/public-product';
import { listLiveBanners, liveWhere, type CampaignBannerDTO } from './campaign-public';

export interface CampaignCouponDTO {
  code: string;
  type: CouponType;
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: string;
}

export interface CampaignDetailDTO extends Omit<CampaignBannerDTO, 'image'> {
  /** null khi ảnh không phục vụ được: trang vẫn mở để khách xem mã và sản phẩm. */
  image: string | null;
  subtitle: string | null;
  productCount: number;
  coupons: CampaignCouponDTO[];
}

// Mã in thẻ hộp hàng (CLAIM theo lô) là bí mật của thẻ; mã TIER/USER_GROUP/BIRTHDAY/INVITE dành riêng cho người nhận: không đưa lên trang công khai.
const PUBLIC_COUPON_SCOPES: readonly CouponScope[] = ['PUBLIC', 'CLAIM'];

interface CouponRow {
  code: string;
  type: CouponType;
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  isActive: boolean;
  scope: CouponScope;
  batch: string | null;
  usageLimit: number | null;
  usedCount: number;
  startAt: Date;
  endAt: Date;
}

function couponShown(c: CouponRow, now: Date): boolean {
  return (
    c.isActive &&
    PUBLIC_COUPON_SCOPES.includes(c.scope) &&
    c.batch === null &&
    c.startAt <= now &&
    c.endAt > now &&
    (c.usageLimit === null || c.usedCount < c.usageLimit)
  );
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  listPublic(placement: CampaignPlacement, audience?: 'NEW' | 'RETURNING'): Promise<CampaignBannerDTO[]> {
    return listLiveBanners(this.prisma, placement, { ...(audience ? { audience } : {}) });
  }

  /** Chiến dịch tắt, chưa mở, đã hết hạn hay không có đều 404 như nhau: bản nháp không lộ qua đoán slug. */
  private async liveBySlug(slug: string, now: Date) {
    const row = await this.prisma.campaign.findFirst({ where: { slug, ...liveWhere(now) } });
    if (!row) throw new NotFoundException('Chương trình không còn hoặc chưa mở.');
    return row;
  }

  async getPublic(slug: string, now: Date = new Date()): Promise<CampaignDetailDTO> {
    const row = await this.prisma.campaign.findFirst({
      where: { slug, ...liveWhere(now) },
      include: { coupons: { orderBy: [{ sortOrder: 'asc' }, { couponId: 'asc' }], include: { coupon: true } } },
    });
    if (!row) throw new NotFoundException('Chương trình không còn hoặc chưa mở.');
    const productCount = await this.prisma.campaignProduct.count({ where: { campaignId: row.id, product: PUBLIC_PRODUCT_WHERE } });
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      image: publicImage('campaign', row.id, 'cover', row.image),
      linkType: row.linkType,
      linkValue: row.linkValue,
      audience: row.audience,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      productCount,
      coupons: row.coupons
        .filter((l) => couponShown(l.coupon, now))
        .map(({ coupon: c }) => ({ code: c.code, type: c.type, value: c.value, minOrder: c.minOrder, maxDiscount: c.maxDiscount, endAt: c.endAt.toISOString() })),
    };
  }

  async getProducts(slug: string, page: number, limit: number, now: Date = new Date()) {
    const campaign = await this.liveBySlug(slug, now);
    // Một chiến dịch giữ tối đa vài trăm sản phẩm (trần ở admin): xếp và cắt trang trong bộ nhớ, rồi dựng thẻ đúng lát trang.
    const rows = await this.prisma.campaignProduct.findMany({
      where: { campaignId: campaign.id, product: PUBLIC_PRODUCT_WHERE },
      orderBy: [{ sortOrder: 'asc' }, { productId: 'asc' }],
      select: { productId: true },
    });
    const ids = rows.map((r) => r.productId);
    const pageIds = ids.slice((page - 1) * limit, page * limit);
    return paginated(await this.catalog.cardsByIds(pageIds), page, limit, ids.length);
  }
}
