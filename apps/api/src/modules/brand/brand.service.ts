import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { BrandSalesPeriod } from './dto/brand.dto';

interface Cert {
  code: string;
  label: string;
  verified?: boolean;
  proofUrl?: string;
}

/** Slugify tiếng Việt: bỏ dấu, đ→d, gạch nối, an toàn cho URL. */
// Combining marks U+0300–U+036F (gồm U+031B 'horn' của ư/ơ). RegExp constructor để source thuần ASCII, tránh lỗi encoding.
const COMBINING_MARKS = new RegExp('[\u0300-\u036f]', 'g');
// \u01b0/\u01af (U+01B0/U+01AF) v\u00e0 \u01a1/\u01a0 (U+01A1/U+01A0) l\u00e0 k\u00fd t\u1ef1 ATOMIC \u2014 KH\u00d4NG decompose d\u01b0\u1edbi NFD,
// n\u00ean combining-strip \u1edf tr\u00ean b\u1ecf s\u00f3t; x\u1eed l\u00fd ri\u00eang. Escape ASCII \u0111\u1ec3 source kh\u00f4ng l\u1ed7i encoding.
const HORNED_U = new RegExp('[\u01b0\u01af]', 'g');
const HORNED_O = new RegExp('[\u01a1\u01a0]', 'g');

// DealerReward.threshold là BigInt (ngưỡng có thể vượt INT4) — JSON không serialize được bigint, còn
// DTO chặn ngưỡng trong Number.MAX_SAFE_INTEGER nên trả về number không mất chính xác.
const rewardView = <T extends { threshold: bigint }>(r: T) => ({ ...r, threshold: Number(r.threshold) });

export function slugifyVi(input: string): string {
  return input
    .normalize('NFD')
    // Bỏ toàn bộ combining marks U+0300–U+036F (gồm cả U+031B "horn" của ư/ơ).
    // Dùng unicode escape thay literal để không phụ thuộc encoding file.
    .replace(COMBINING_MARKS, '')
    .replace(HORNED_U, 'u')
    .replace(HORNED_O, 'o')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type PromotableCoupon = { scope: string | null; startAt: Date; endAt: Date; usageLimit: number | null; usedCount: number };

/** Khách chạm sao chép mã trên trang nhãn rồi dán ở thanh toán: chỉ mã công khai, trong hạn, còn lượt mới dùng được. */
function couponUsableNow(c: PromotableCoupon, now: Date): boolean {
  if (c.scope != null && c.scope !== 'PUBLIC') return false;
  if (now < c.startAt || now > c.endAt) return false;
  return c.usageLimit == null || c.usedCount < c.usageLimit;
}

const VN_OFFSET_MS = 7 * 3600e3;
const DAY_MS = 864e5;
const SALES_TOP_PRODUCTS = 10;

// Đơn nào tính là doanh thu của nhãn: đã qua bước chờ thanh toán, chưa huỷ/trả, chưa hoàn tiền/lỗi thanh toán.
// Đơn COD vào thẳng CONFIRMED nên được tính ngay; đơn chuyển khoản chỉ tính sau khi đã trả.
const SALES_ORDER_STATUS_EXCLUDED = ['PENDING_PAYMENT', 'CANCELLED', 'RETURNED'] as const;
const SALES_ORDER_PAYMENT_EXCLUDED = ['REFUNDED', 'FAILED'] as const;

/** Khoảng thời gian [from, to] của kỳ báo cáo; "tháng" tính theo lịch giờ VN (UTC+7, không có giờ mùa hè). */
function brandSalesRange(period: BrandSalesPeriod, now: Date): { from: Date; to: Date } {
  const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
  const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month, 1) - VN_OFFSET_MS);
  const y = vnNow.getUTCFullYear();
  const m = vnNow.getUTCMonth();
  switch (period) {
    case '7d':
      return { from: new Date(now.getTime() - 7 * DAY_MS), to: now };
    case '90d':
      return { from: new Date(now.getTime() - 90 * DAY_MS), to: now };
    case 'month':
      return { from: monthStart(y, m), to: now };
    case 'prev_month':
      return { from: monthStart(y, m - 1), to: new Date(monthStart(y, m).getTime() - 1) };
    case '30d':
    default:
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
  }
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
        // variations chỉ để tính inStock (audit A4-06 — lưới trang nhãn chưa từng biết SP hết
        // hàng hay chưa); ProductTile cần cờ này để hiện overlay "tạm hết hàng".
        select: { id: true, name: true, slug: true, thumbnail: true, basePrice: true, salePrice: true, ratingAvg: true, reviewCount: true, soldExternal: true, soldApp: true, variations: { where: { isActive: true }, select: { stock: true } } },
      }),
      this.prisma.dealerReward.findMany({
        where: { OR: [{ brandId: brand.id }, { brandId: null }], isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, type: true, title: true, description: true, threshold: true, period: true },
      }),
    ]);

    const publicPromotions = await this.hideUnusableCoupons(promotions, now);

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
      promotions: publicPromotions,
      products: products.map(({ soldExternal, soldApp, variations, ...p }) => ({
        ...p,
        sold: soldExternal + soldApp,
        inStock: (variations ?? []).some((v) => v.stock > 0),
      })),
      dealerRewards: dealerRewards.map(rewardView),
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

  async updateBrand(
    id: string,
    dto: {
      name?: string;
      slug?: string;
      logoUrl?: string;
      coverUrl?: string;
      tagline?: string;
      story?: string;
      origin?: string;
      certifications?: unknown;
      isPublished?: boolean;
      ownerUserId?: string;
    },
  ) {
    await this.prisma.brand.findUniqueOrThrow({ where: { id } });
    const data: Record<string, unknown> = { ...dto };
    if (typeof dto.slug === 'string') {
      // Chặn slug rỗng tường minh (dto.slug='') — trước đây bị guard `&& dto.slug.trim()` bỏ qua
      // nên '' vẫn lọt vào `data = {...dto}` và ghi đè cột slug @unique thành rỗng.
      if (!dto.slug.trim()) throw new BadRequestException('Slug không được để trống.');
      const slug = slugifyVi(dto.slug);
      if (!slug) throw new BadRequestException('Slug không hợp lệ (rỗng sau khi chuẩn hoá).');
      data.slug = slug;
    }
    if (typeof dto.name === 'string' && !dto.name.trim()) {
      // Cùng lỗi như slug: name cũng @unique, name='' tường minh phải bị chặn.
      throw new BadRequestException('Tên nhãn không được để trống.');
    }
    // Gán chủ nhãn: Brand.ownerUserId không có FK tới User (nullable, gán tay) → tự kiểm tra
    // user tồn tại, tránh admin gõ sai id → gán "chủ ma" mà không ai được cảnh báo.
    if (typeof dto.ownerUserId === 'string' && dto.ownerUserId.trim()) {
      const owner = await this.prisma.user.findUnique({ where: { id: dto.ownerUserId.trim() }, select: { id: true } });
      if (!owner) throw new BadRequestException('userId chủ nhãn không tồn tại.');
      data.ownerUserId = owner.id;
    }
    return this.prisma.brand.update({ where: { id }, data });
  }

  verifyBrand(id: string, isVerified: boolean) {
    return this.prisma.brand.update({ where: { id }, data: { isVerified } });
  }

  // ---- Admin: BrandPromotion ----
  /** Tất cả khuyến mãi của nhãn (admin — gồm cả hết hạn/đã tắt). */
  listPromotions(brandId: string) {
    return this.prisma.brandPromotion.findMany({ where: { brandId }, orderBy: { sortOrder: 'asc' } });
  }

  /**
   * Chuẩn hoá mã giảm giá gắn vào khuyến mãi: phải là mã CÓ THẬT trong bảng Coupon, công khai, chưa
   * hết hạn/hết lượt. Trả về đúng chuỗi `Coupon.code` (checkout so khớp chính xác), không phải chuỗi người nhập.
   * Mã có hiệu lực từ ngày mai vẫn được gắn — chủ nhãn lên lịch chiến dịch trước.
   */
  private async resolvePromotionCoupon(raw: string | undefined | null, now: Date): Promise<string | null> {
    const typed = raw?.trim();
    if (!typed) return null;
    const coupon = await this.prisma.coupon.findFirst({ where: { code: { in: [typed, typed.toUpperCase()] } } });
    if (!coupon) {
      throw new BadRequestException(`Mã giảm giá "${typed}" chưa có trong hệ thống. Nhờ Tubu tạo mã trước, rồi gắn vào khuyến mãi.`);
    }
    if (coupon.scope !== 'PUBLIC') {
      throw new BadRequestException('Mã giảm giá này chỉ dành riêng cho một nhóm khách nên không thể đăng công khai trên trang nhãn.');
    }
    if (now > coupon.endAt) throw new BadRequestException('Mã giảm giá này đã hết hạn.');
    if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('Mã giảm giá này đã hết lượt sử dụng.');
    }
    return coupon.code;
  }

  /**
   * Trang nhãn là bản sao công khai (cache): mã đã hết hạn/hết lượt/chưa hiệu lực, hoặc mã cũ lưu tự do
   * từ trước khi có kiểm tra, không được hiện nút "chạm để chép" — khách dán vào thanh toán sẽ bị từ chối.
   * Khuyến mãi vẫn hiện (chỉ mất mã); mã còn dùng được trả đúng chuỗi `Coupon.code`.
   */
  private async hideUnusableCoupons<T extends { couponCode: string | null }>(promotions: T[], now: Date): Promise<T[]> {
    const typed = [...new Set(promotions.map((p) => p.couponCode).filter((c): c is string => !!c))];
    if (typed.length === 0) return promotions;
    const rows = await this.prisma.coupon.findMany({
      where: { code: { in: [...new Set(typed.flatMap((c) => [c, c.toUpperCase()]))] } },
      select: { code: true, scope: true, startAt: true, endAt: true, usageLimit: true, usedCount: true },
    });
    const usable = new Map(rows.filter((r) => couponUsableNow(r, now)).map((r) => [r.code, r.code]));
    return promotions.map((p) => ({
      ...p,
      couponCode: p.couponCode ? (usable.get(p.couponCode) ?? usable.get(p.couponCode.toUpperCase()) ?? null) : null,
    }));
  }

  async createPromotion(
    brandId: string,
    dto: { title: string; subtitle?: string; themeColor?: string; couponCode?: string; startAt: string; endAt: string; sortOrder?: number },
    now: Date = new Date(),
  ) {
    const couponCode = await this.resolvePromotionCoupon(dto.couponCode, now);
    return this.prisma.brandPromotion.create({
      data: {
        brandId,
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        themeColor: dto.themeColor ?? null,
        couponCode,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updatePromotion(
    id: string,
    dto: {
      title?: string;
      subtitle?: string;
      themeColor?: string;
      couponCode?: string;
      startAt?: string;
      endAt?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
    now: Date = new Date(),
  ) {
    const data: Record<string, unknown> = { ...dto };
    if (typeof dto.startAt === 'string') data.startAt = new Date(dto.startAt);
    if (typeof dto.endAt === 'string') data.endAt = new Date(dto.endAt);
    if (typeof dto.couponCode === 'string') {
      const wanted = dto.couponCode.trim();
      if (!wanted) {
        data.couponCode = null;
      } else {
        // Giữ nguyên mã đang lưu thì không kiểm lại: sửa tiêu đề không được bị chặn chỉ vì mã đã hết hạn.
        const current = await this.prisma.brandPromotion.findUnique({ where: { id }, select: { couponCode: true } });
        data.couponCode =
          current?.couponCode && current.couponCode.toUpperCase() === wanted.toUpperCase()
            ? current.couponCode
            : await this.resolvePromotionCoupon(wanted, now);
      }
    }
    return this.prisma.brandPromotion.update({ where: { id }, data });
  }

  async deletePromotion(id: string) {
    await this.prisma.brandPromotion.delete({ where: { id } });
    return { ok: true };
  }

  // ---- Admin: DealerReward ----
  async listDealerRewards() {
    const rows = await this.prisma.dealerReward.findMany({ orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }] });
    return rows.map(rewardView);
  }

  async createDealerReward(dto: {
    brandId?: string;
    type: 'TOUR' | 'GIFT' | 'OTHER';
    title: string;
    description?: string;
    threshold: number;
    period?: string;
    sortOrder?: number;
  }) {
    const row = await this.prisma.dealerReward.create({
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
    return rewardView(row);
  }

  async updateDealerReward(
    id: string,
    dto: {
      title?: string;
      description?: string;
      threshold?: number;
      period?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    return rewardView(await this.prisma.dealerReward.update({ where: { id }, data: dto }));
  }

  async deleteDealerReward(id: string) {
    await this.prisma.dealerReward.delete({ where: { id } });
    return { ok: true };
  }

  // ---- Admin: gán sản phẩm vào nhãn (Product.brandId) ----
  /**
   * SP của nhãn (admin xem để quản lý). Phân trang (take/skip) — trước đây trả toàn bộ SP của
   * nhãn không giới hạn, nhãn nhiều SP → payload lớn, chậm (mirror pattern StorefrontService.pickerProducts).
   */
  listBrandProducts(brandId: string, query: { page?: number; limit?: number } = {}) {
    const take = Math.min(query.limit ?? 20, 50);
    const skip = ((query.page ?? 1) - 1) * take;
    return this.prisma.product.findMany({
      where: { brandId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      take,
      skip,
      select: { id: true, name: true, slug: true, thumbnail: true, brand: true, isActive: true },
    });
  }

  /** Gán 1 danh sách SP vào nhãn (set brandId). */
  async attachProducts(brandId: string, productIds: string[]) {
    await this.prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new BadRequestException('Cần ít nhất một sản phẩm để gán.');
    }
    const res = await this.prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: { brandId },
    });
    return { attached: res.count };
  }

  /** Gỡ SP khỏi nhãn — CHỈ gỡ SP đang thuộc đúng nhãn này (tránh gỡ nhầm của nhãn khác). */
  async detachProducts(brandId: string, productIds: string[]) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new BadRequestException('Cần ít nhất một sản phẩm để gỡ.');
    }
    const res = await this.prisma.product.updateMany({
      where: { id: { in: productIds }, brandId },
      data: { brandId: null },
    });
    return { detached: res.count };
  }

  /** Tự động gán tất cả SP có chuỗi `Product.brand` trùng tên nhãn (tận dụng dữ liệu cũ). */
  async linkProductsByName(brandId: string) {
    const brand = await this.prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
    const res = await this.prisma.product.updateMany({
      where: { brand: brand.name },
      data: { brandId },
    });
    return { linked: res.count };
  }

  // ---- Theo dõi nhãn ----
  /** Theo dõi nhãn (idempotent qua @@unique(userId,brandId): theo dõi lại → no-op). */
  async followBrand(userId: string, slug: string) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isPublished: true }, select: { id: true } });
    if (!brand) throw new NotFoundException('Nhãn hàng không tồn tại.');
    try {
      await this.prisma.$transaction([
        this.prisma.brandFollow.create({ data: { userId, brandId: brand.id } }),
        this.prisma.brand.update({ where: { id: brand.id }, data: { followerCount: { increment: 1 } } }),
      ]);
    } catch (err) {
      // Đã theo dõi (unique violation) → bỏ qua, không tăng count lần nữa.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    const fresh = await this.prisma.brand.findUniqueOrThrow({ where: { id: brand.id }, select: { followerCount: true } });
    return { following: true, followerCount: fresh.followerCount };
  }

  /** Bỏ theo dõi (chỉ giảm count khi thực sự đang theo dõi). */
  async unfollowBrand(userId: string, slug: string) {
    const brand = await this.prisma.brand.findFirst({ where: { slug }, select: { id: true } });
    if (!brand) throw new NotFoundException('Nhãn hàng không tồn tại.');
    const del = await this.prisma.brandFollow.deleteMany({ where: { userId, brandId: brand.id } });
    if (del.count > 0) {
      await this.prisma.brand.update({ where: { id: brand.id }, data: { followerCount: { decrement: 1 } } });
    }
    const fresh = await this.prisma.brand.findUniqueOrThrow({ where: { id: brand.id }, select: { followerCount: true } });
    return { following: false, followerCount: fresh.followerCount };
  }

  // ---- Brand-owner tự quản (lộ trình B) — auth bằng quyền sở hữu ----
  private async assertOwnedBrand(userId: string) {
    // orderBy tất định: nếu 1 user (do admin gán) sở hữu >1 nhãn, luôn trả nhãn CŨ NHẤT
    // (thay vì thứ tự ngẫu nhiên của Postgres) — người chủ luôn vào đúng 1 nhãn nhất quán.
    const brand = await this.prisma.brand.findFirst({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'asc' },
    });
    if (!brand) throw new NotFoundException('Bạn chưa được cấp quyền quản lý nhãn nào.');
    return brand;
  }

  /** Nhãn mà user đang sở hữu (+ promotions) cho màn quản lý — 1 query (include) thay vì 2 round-trip. */
  async getOwnedBrand(userId: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'asc' },
      include: { promotions: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!brand) throw new NotFoundException('Bạn chưa được cấp quyền quản lý nhãn nào.');
    return brand;
  }

  /** Brand-owner sửa THÔNG TIN nhãn — CHỈ logo/cover/tagline/story/origin (chống sửa name/verified/publish/cert). */
  async updateOwnedBrand(
    userId: string,
    dto: { logoUrl?: string; coverUrl?: string; tagline?: string; story?: string; origin?: string },
  ) {
    const brand = await this.assertOwnedBrand(userId);
    const data: Record<string, unknown> = {};
    for (const k of ['logoUrl', 'coverUrl', 'tagline', 'story', 'origin'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    return this.prisma.brand.update({ where: { id: brand.id }, data });
  }

  listOwnedPromotions(userId: string) {
    return this.assertOwnedBrand(userId).then((b) => this.listPromotions(b.id));
  }

  async createOwnedPromotion(
    userId: string,
    dto: { title: string; subtitle?: string; themeColor?: string; couponCode?: string; startAt: string; endAt: string; sortOrder?: number },
  ) {
    const brand = await this.assertOwnedBrand(userId);
    return this.createPromotion(brand.id, dto);
  }

  private async assertOwnedPromotion(userId: string, promoId: string) {
    const brand = await this.assertOwnedBrand(userId);
    const promo = await this.prisma.brandPromotion.findUnique({ where: { id: promoId } });
    if (!promo || promo.brandId !== brand.id) throw new ForbiddenException('Không có quyền với khuyến mãi này.');
    return promo;
  }

  async updateOwnedPromotion(userId: string, promoId: string, dto: Parameters<BrandService['updatePromotion']>[1]) {
    await this.assertOwnedPromotion(userId, promoId);
    return this.updatePromotion(promoId, dto);
  }

  async deleteOwnedPromotion(userId: string, promoId: string) {
    await this.assertOwnedPromotion(userId, promoId);
    return this.deletePromotion(promoId);
  }

  /**
   * Doanh thu nhãn cho chính chủ nhãn xem (Q-18) — CHỈ ĐỌC và CHỈ SỐ TỔNG HỢP: số đơn, doanh thu,
   * sản phẩm bán chạy. Không có truy vấn nào đọc bản ghi đơn nên không thể kéo tên/SĐT/địa chỉ khách.
   * Quyền: nhãn lấy từ chính `Brand.ownerUserId` của người gọi — không nhận brandId từ client.
   * Doanh thu = tổng `OrderItem.total` của các dòng thuộc SP của nhãn (giá bán gốc × số lượng, trước mã giảm
   * giá toàn đơn và chưa gồm phí ship — giảm giá theo đơn không chia được cho từng nhãn một cách công bằng).
   * Một đơn có hàng của nhiều nhãn chỉ tính phần dòng của nhãn này. `now` truyền vào để test tất định.
   */
  async getOwnedSales(userId: string, period: BrandSalesPeriod = '30d', now: Date = new Date()) {
    const brand = await this.assertOwnedBrand(userId);
    const { from, to } = brandSalesRange(period, now);
    const base = { period, from: from.toISOString(), to: to.toISOString() };

    const variations = await this.prisma.variation.findMany({
      where: { product: { brandId: brand.id } },
      select: { id: true, product: { select: { id: true, name: true, slug: true } } },
    });
    if (variations.length === 0) {
      return { ...base, orderCount: 0, unitsSold: 0, revenue: 0, delivered: { orderCount: 0, revenue: 0 }, topProducts: [] };
    }

    const variationIds = variations.map((v) => v.id);
    const productOf = new Map(variations.map((v) => [v.id, v.product]));
    const orderWhere = {
      createdAt: { gte: from, lte: to },
      status: { notIn: [...SALES_ORDER_STATUS_EXCLUDED] },
      paymentStatus: { notIn: [...SALES_ORDER_PAYMENT_EXCLUDED] },
    } satisfies Prisma.OrderWhereInput;
    const deliveredWhere = { ...orderWhere, status: 'DELIVERED' } satisfies Prisma.OrderWhereInput;
    const hasBrandLine = { some: { variationId: { in: variationIds } } };

    const [lines, orderCount, deliveredOrderCount, deliveredLines] = await Promise.all([
      this.prisma.orderItem.groupBy({
        by: ['variationId'],
        where: { variationId: { in: variationIds }, order: orderWhere },
        _sum: { quantity: true, total: true },
      }),
      this.prisma.order.count({ where: { ...orderWhere, items: hasBrandLine } }),
      this.prisma.order.count({ where: { ...deliveredWhere, items: hasBrandLine } }),
      this.prisma.orderItem.aggregate({
        where: { variationId: { in: variationIds }, order: deliveredWhere },
        _sum: { total: true },
      }),
    ]);

    const byProduct = new Map<string, { productId: string; name: string; slug: string; quantity: number; revenue: number }>();
    let revenue = 0;
    let unitsSold = 0;
    for (const line of lines) {
      const product = productOf.get(line.variationId);
      if (!product) continue;
      const quantity = line._sum.quantity ?? 0;
      const lineRevenue = line._sum.total ?? 0;
      revenue += lineRevenue;
      unitsSold += quantity;
      const row = byProduct.get(product.id) ?? { productId: product.id, name: product.name, slug: product.slug, quantity: 0, revenue: 0 };
      row.quantity += quantity;
      row.revenue += lineRevenue;
      byProduct.set(product.id, row);
    }
    const topProducts = [...byProduct.values()]
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
      .slice(0, SALES_TOP_PRODUCTS);

    return {
      ...base,
      orderCount,
      unitsSold,
      revenue,
      delivered: { orderCount: deliveredOrderCount, revenue: deliveredLines._sum.total ?? 0 },
      topProducts,
    };
  }

  /** Trạng thái theo dõi của user với nhãn (cho FE hiện nút). */
  async followState(userId: string, slug: string) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isPublished: true }, select: { id: true, followerCount: true } });
    if (!brand) throw new NotFoundException('Nhãn hàng không tồn tại.');
    const f = await this.prisma.brandFollow.findUnique({ where: { userId_brandId: { userId, brandId: brand.id } } });
    return { following: Boolean(f), followerCount: brand.followerCount };
  }
}
