import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface Cert {
  code: string;
  label: string;
  verified?: boolean;
  proofUrl?: string;
}

/** Slugify tiếng Việt: bỏ dấu, đ→d, gạch nối, an toàn cho URL. */
export function slugifyVi(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  /** Trang nhãn flagship cho khách. `now` truyền vào để test tất định. KHÔNG lộ % hoa hồng. */
  async getPublicBySlug(slug: string, now: Date = new Date()) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isPublished: true } });
    if (!brand) throw new NotFoundException('Nhãn hàng không tồn tại hoặc chưa đăng.');

    const certs: Cert[] = Array.isArray(brand.certifications) ? (brand.certifications as unknown as Cert[]) : [];
    const verifiedCerts = certs
      .filter((c) => c && c.verified === true)
      .map((c) => ({ code: c.code, label: c.label, proofUrl: c.proofUrl ?? null }));

    const [promotions, products, dealerRewards] = await Promise.all([
      this.prisma.brandPromotion.findMany({
        where: { brandId: brand.id, isActive: true, startAt: { lte: now }, endAt: { gte: now } },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, title: true, subtitle: true, themeColor: true, couponCode: true, startAt: true, endAt: true },
      }),
      this.prisma.product.findMany({
        where: { brandId: brand.id, isActive: true },
        orderBy: [{ isFeatured: 'desc' }, { reviewCount: 'desc' }],
        take: 30,
        select: { id: true, name: true, slug: true, thumbnail: true, basePrice: true, salePrice: true, ratingAvg: true, reviewCount: true },
      }),
      this.prisma.dealerReward.findMany({
        where: { OR: [{ brandId: brand.id }, { brandId: null }], isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, type: true, title: true, description: true, threshold: true, period: true },
      }),
    ]);

    return {
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      logoUrl: brand.logoUrl,
      coverUrl: brand.coverUrl,
      tagline: brand.tagline,
      story: brand.story,
      storyImages: brand.storyImages,
      origin: brand.origin,
      isVerified: brand.isVerified,
      followerCount: brand.followerCount,
      certifications: verifiedCerts,
      promotions,
      products,
      dealerRewards,
    };
  }

  /** Banner "Chia sẻ nhận HH" — CHỈ AFFILIATE thấy %; khách thường eligible=false (guardrail server-side). */
  async getShareToEarn(slug: string, userId: string) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isPublished: true }, select: { id: true, slug: true } });
    if (!brand) throw new NotFoundException('Nhãn hàng không tồn tại.');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, referralCode: true },
    });
    if (user.role !== 'AFFILIATE') return { eligible: false as const };
    const variations = await this.prisma.variation.findMany({
      where: { product: { brandId: brand.id, isActive: true, affiliateBlocked: false } },
      select: { affiliateRate: true },
    });
    const maxAffiliateRate = variations.reduce(
      (m, v) => Math.max(m, v.affiliateRate ? Number(v.affiliateRate) : 0),
      0,
    );
    return { eligible: true as const, maxAffiliateRate, referralCode: user.referralCode, brandSlug: brand.slug };
  }

  // ---- Admin: Brand ----
  listBrands() {
    return this.prisma.brand.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createBrand(dto: {
    name: string;
    slug?: string;
    logoUrl?: string;
    coverUrl?: string;
    tagline?: string;
    story?: string;
    origin?: string;
    certifications?: unknown;
    isPublished?: boolean;
  }) {
    const slug = dto.slug?.trim() ? slugifyVi(dto.slug) : slugifyVi(dto.name);
    if (!slug) throw new BadRequestException('Tên nhãn không hợp lệ để tạo slug.');
    return this.prisma.brand.create({
      data: {
        name: dto.name,
        slug,
        logoUrl: dto.logoUrl ?? null,
        coverUrl: dto.coverUrl ?? null,
        tagline: dto.tagline ?? null,
        story: dto.story ?? null,
        origin: dto.origin ?? null,
        certifications: (dto.certifications as object) ?? undefined,
        isPublished: dto.isPublished ?? false,
      },
    });
  }

  async updateBrand(id: string, dto: Record<string, unknown>) {
    await this.prisma.brand.findUniqueOrThrow({ where: { id } });
    const data: Record<string, unknown> = { ...dto };
    if (typeof dto.slug === 'string' && dto.slug.trim()) data.slug = slugifyVi(dto.slug);
    return this.prisma.brand.update({ where: { id }, data });
  }

  verifyBrand(id: string, isVerified: boolean) {
    return this.prisma.brand.update({ where: { id }, data: { isVerified } });
  }

  // ---- Admin: BrandPromotion ----
  createPromotion(
    brandId: string,
    dto: { title: string; subtitle?: string; themeColor?: string; couponCode?: string; startAt: string; endAt: string; sortOrder?: number },
  ) {
    return this.prisma.brandPromotion.create({
      data: {
        brandId,
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        themeColor: dto.themeColor ?? null,
        couponCode: dto.couponCode ?? null,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  updatePromotion(id: string, dto: Record<string, unknown>) {
    const data: Record<string, unknown> = { ...dto };
    if (typeof dto.startAt === 'string') data.startAt = new Date(dto.startAt);
    if (typeof dto.endAt === 'string') data.endAt = new Date(dto.endAt);
    return this.prisma.brandPromotion.update({ where: { id }, data });
  }

  async deletePromotion(id: string) {
    await this.prisma.brandPromotion.delete({ where: { id } });
    return { ok: true };
  }

  // ---- Admin: DealerReward ----
  listDealerRewards() {
    return this.prisma.dealerReward.findMany({ orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }] });
  }

  createDealerReward(dto: {
    brandId?: string;
    type: 'TOUR' | 'GIFT' | 'OTHER';
    title: string;
    description?: string;
    threshold: number;
    period?: string;
    sortOrder?: number;
  }) {
    return this.prisma.dealerReward.create({
      data: {
        brandId: dto.brandId ?? null,
        type: dto.type,
        title: dto.title,
        description: dto.description ?? null,
        threshold: dto.threshold,
        period: dto.period ?? 'QUARTER',
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  updateDealerReward(id: string, dto: Record<string, unknown>) {
    return this.prisma.dealerReward.update({ where: { id }, data: dto });
  }

  async deleteDealerReward(id: string) {
    await this.prisma.dealerReward.delete({ where: { id } });
    return { ok: true };
  }
}
