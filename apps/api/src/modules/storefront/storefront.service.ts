import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { storefrontSalesByProduct, storefrontSalesByStore } from '../affiliate/storefront-sales';
import { hasAffiliateAccess } from '../affiliate/affiliate-access';
import { loadDefaultRate, maxResolvedRate } from '../affiliate/commission-rate';
import { normalizeSubdomain, assertIdentifierAvailable, recordReleasedIdentifiers } from './identifier-validation';
import { isPartnerOwnedProduct, partnerGoodsError } from '../cart/partner-goods';
import { MIN_COMBO_PRODUCTS } from './combo.service';
import { isPartnerStore } from '../merchant/partner-store';
import { decodeServedImage } from '../../common/served-image';
import { cardPrices } from '../catalog/variation-order';
import { publicDisplayName } from '../../common/mask-name';
import { assertStorefrontImagesAllowed, isStorefrontImageKind, matchesStorefrontImageVersion, publicStorefrontImage } from './storefront-images';
import { isStorefrontApprovalRequired, isStorefrontSubdomainEnabled, withSubdomainFlag } from './storefront-config';
import { isStorefrontApproved, ownerStorefrontState, publicStorefrontWhere } from './storefront-visibility';
import { assertCanPublish, isLostToTakeDown, PUBLISH_WHERE_NOT_TAKEN_DOWN, takenDownError } from './storefront-publish';

// Chặn CTV tạo vô hạn bộ sưu tập/sản phẩm trong 1 gian hàng (không ai cần vượt số này để
// bán hàng bình thường) — mirror MAX_WISHLIST_ITEMS ở wishlist.service.ts.
const MAX_COLLECTIONS_PER_STORE = 30;
const MAX_ITEMS_PER_COLLECTION = 100;
// Trần hostname DNS (RFC 1035): dài hơn không thể là host thật.
const HOST_MAX_LENGTH = 253;

/** Lý do khách không thấy một món trong gian hàng (null = khách thấy) — cùng điều kiện lọc của getPublicBySlug. */
export function buyerHiddenReason(item: {
  isHidden: boolean;
  product: { isActive: boolean; affiliateBlocked: boolean; approvalStatus: string | null };
}): string | null {
  if (item.isHidden) return 'Bạn đang ẩn món này';
  if (item.product.approvalStatus && item.product.approvalStatus !== 'APPROVED') return 'Sản phẩm chưa được duyệt bán';
  if (!item.product.isActive) return 'Sản phẩm đã ngừng bán';
  if (item.product.affiliateBlocked) return 'Sản phẩm không còn cho CTV bán';
  return null;
}

@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    // AffiliateModule là @Global() (affiliate.module.ts) — inject thẳng không cần import module,
    // không tạo circular dependency (AffiliateModule không phụ thuộc ngược lại StorefrontModule).
    private readonly affiliate: AffiliateService,
  ) {}

  /**
   * Trần % giảm combo — CTV tự đăng ký không cần duyệt (POST /affiliate/register), nên
   * comboDiscountPct KHÔNG được chỉ tin DTO (@Max(100) chỉ chặn kiểu dữ liệu). Không có trần
   * server-side, một CTV có thể đặt combo 100% trên gian hàng của chính mình → đơn thật 0đ,
   * shop trả tiền (P0, docs/2026-09-08-review-progress.md). Clamp thay vì reject — thân thiện
   * hơn cho CTV lỡ tay nhập nhầm, và combo.service.ts vẫn tự clamp lại lần 2 (defense in depth)
   * phòng dữ liệu cũ/ghi thẳng DB từ trước khi có trần này.
   */
  private async clampComboPct(pct: number | undefined): Promise<number | undefined> {
    if (pct == null) return pct;
    const max = await this.config.get<number>('storefront.max_combo_pct', 30);
    return Math.min(pct, max);
  }

  private async visibilityOptions() {
    const [roles, requireApproval] = await Promise.all([this.affiliate.commissionEligibleRoles(), isStorefrontApprovalRequired(this.config)]);
    return { eligibleRoles: [...roles], requireApproval };
  }

  async getOrCreateMine(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const canCreate = user.role === 'AFFILIATE' || user.role === 'ADMIN';
    // CTV được duyệt lên đại lý giữ gian hàng CTV (D3-03): mở lại được, nhưng đại lý không tạo gian hàng CTV mới.
    if (!canCreate && user.role !== 'DEALER') {
      throw new BadRequestException('Chỉ CTV mới tạo được gian hàng.');
    }
    const existing = await this.prisma.storefront.findFirst({ where: { ownerUserId: userId, type: 'CTV' } });
    if (existing) return existing;
    if (!canCreate) throw new BadRequestException('Chỉ CTV mới tạo được gian hàng.');
    try {
      return await this.prisma.storefront.create({
        data: {
          type: 'CTV',
          // referralCode luôn in hoa (auth.service.ts sinh bằng toUpperCase). Nếu lưu nguyên,
          // slug in hoa sẽ KHÔNG BAO GIỜ khớp getPublicBySlug (hàm đó hạ chữ mã tra cứu rồi so
          // khớp chính xác; Postgres phân biệt hoa/thường) → mọi link gian hàng CTV đều chết.
          // Chuẩn hoá tại nguồn; phía đọc cũng so khớp insensitive để cứu dữ liệu cũ.
          slug: user.referralCode.toLowerCase(),
          ownerUserId: userId,
          title: `Cửa hàng của ${publicDisplayName(user.fullName, 'bạn')}`,
        },
      });
    } catch (err) {
      // Race: 2 request tạo gian hàng đồng thời → request thua unique constraint (slug/ownerUserId)
      // thay vì trả 500 thô, trả lại gian hàng vừa được tạo bởi request thắng.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.storefront.findFirst({ where: { ownerUserId: userId, type: 'CTV' } });
        if (raced) return raced;
      }
      throw err;
    }
  }

  async getMine(userId: string) {
    const sf = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId, type: 'CTV' },
      include: {
        owner: { select: { role: true, isBlocked: true, referralCode: true } },
        collections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            items: {
              orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }],
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    thumbnail: true,
                    brand: true,
                    basePrice: true,
                    salePrice: true,
                    ratingAvg: true,
                    reviewCount: true,
                    isActive: true,
                    affiliateBlocked: true,
                    approvalStatus: true,
                    variations: { where: { isActive: true }, select: { id: true, sku: true, retailPrice: true, salePrice: true, stock: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!sf) throw new NotFoundException('Chưa có gian hàng.');
    const { owner, ...rest } = sf;
    const subdomainEnabled = await isStorefrontSubdomainEnabled(this.config);
    const visibility = await this.visibilityOptions();
    const ownerState = ownerStorefrontState(sf, owner, visibility);
    // SELLER-15: builder đánh dấu món khách không thấy (cùng điều kiện lọc của trang công khai) thay vì hiện như bình thường.
    return {
      ...withSubdomainFlag(rest, subdomainEnabled),
      // Nút Chia sẻ của builder dựng link /s/<slug>?ref=<mã> từ đây, cùng cách trang công khai trả mã (SELLER-4).
      referralCode: owner?.referralCode ?? null,
      approved: isStorefrontApproved(sf),
      // Cờ duyệt bật và chưa được duyệt: đăng xong còn chờ Tubu. Đã duyệt hoặc cờ tắt thì đăng lại là lên ngay.
      needsApproval: visibility.requireApproval && !isStorefrontApproved(sf),
      // Màn không tự suy trạng thái từ isPublished: đã đăng chưa chắc khách đã thấy (còn chờ duyệt lần đầu).
      status: ownerState.status,
      // Chủ vẫn xem và sửa được gian hàng đang ẩn với khách; dòng này nói vì sao.
      publicHiddenReason: ownerState.reason,
      collections: sf.collections.map((c) => ({
        ...c,
        items: c.items.map((i) => {
          const { variations, ...product } = i.product;
          return { ...i, product: { ...product, ...cardPrices(product, variations) }, hiddenReason: buyerHiddenReason(i) };
        }),
      })),
    };
  }

  async updateMine(
    userId: string,
    dto: {
      title?: string;
      headerNote?: string;
      avatarUrl?: string;
      coverUrl?: string;
      theme?: string;
      themeColor?: string;
      subdomain?: string;
      bankName?: string;
      bankBin?: string;
      bankAccountNo?: string;
      bankAccountName?: string;
      warehouseAddress?: string;
      warehouseCity?: string;
      warehouseDistrict?: string;
      warehouseWard?: string;
      warehousePhone?: string;
    },
  ) {
    const sf = await this.assertOwnedStorefront(userId);
    assertStorefrontImagesAllowed(dto, sf);
    // Builder gửi lại subdomain đang lưu mỗi lần bấm Lưu: không đổi thì bỏ qua, không kiểm từ khoá/trùng và không ghi lại.
    if (dto.subdomain && dto.subdomain.trim().toLowerCase() === sf.subdomain) dto.subdomain = undefined;
    if (dto.subdomain) {
      const sub = normalizeSubdomain(dto.subdomain);
      // Kiểm trùng CHÉO cả slug/subdomain/customDomain — trước đây chỉ kiểm trùng subdomain-
      // với-subdomain, cho phép chiếm subdomain trùng SLUG của gian hàng khác (P0-1,
      // docs/2026-09-08-review-progress.md).
      await assertIdentifierAvailable(this.prisma, sub, sf.id);
      dto.subdomain = sub;
    }
    // Chỉ gian hàng đối tác tự giao mới có kho gửi hàng/hotline; CTV gửi lên thì bỏ qua (SELLER-8).
    // Chuỗi rỗng = CHỦ ĐỘNG XOÁ → ghi null. FE gửi '' khi CTV xoá ảnh/lời nhắn (gửi undefined
    // thì PATCH bỏ qua trường đó, xoá xong ảnh cũ vẫn còn). Lưu '' thay vì null sẽ làm bẩn dữ
    // liệu và khiến điều kiện `Boolean(sf.avatarUrl && ...)` của nhiệm vụ hồ sơ đọc khó hiểu.
    const data: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v === undefined || (!isPartnerStore(sf) && k.startsWith('warehouse'))) continue;
      data[k] = k !== 'title' && typeof v === 'string' && v.trim() === '' ? null : v;
    }
    if (dto.subdomain && dto.subdomain !== sf.subdomain) {
      await recordReleasedIdentifiers(this.prisma, sf.id, [sf.subdomain], [dto.subdomain]);
    }
    return this.prisma.storefront.update({ where: { id: sf.id }, data });
  }

  async publishMine(userId: string, isPublished: boolean) {
    const sf = await this.assertOwnedStorefront(userId);
    if (isPublished) await assertCanPublish(this.prisma, sf);
    try {
      await this.prisma.storefront.update({
        where: { id: sf.id, ...(isPublished ? PUBLISH_WHERE_NOT_TAKEN_DOWN : {}) },
        data: { isPublished, publishedAt: isPublished ? new Date() : null },
      });
      // Trả đúng dạng getMine (kèm status/needsApproval) để màn báo "khách xem được ngay" hay "đã gửi duyệt" theo kết quả thật
      // máy chủ vừa tính, không theo cờ đã tải từ trước.
      return await this.getMine(userId);
    } catch (err) {
      if (isPublished && isLostToTakeDown(err)) throw takenDownError(null);
      throw err;
    }
  }

  async pickerProducts(userId: string, q: { search?: string; page?: number; limit?: number }) {
    // Guardrail §9: picker trả maxAffiliateRate (% hoa hồng) → CHỈ CTV/Admin và đại lý còn gian hàng CTV hay hoa hồng
    // (hasAffiliateAccess, D3-03) được gọi, không lộ % hoa hồng cho khách thường.
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true } });
    if (!(await hasAffiliateAccess(this.prisma, user))) {
      throw new BadRequestException('Chỉ CTV mới xem được danh sách sản phẩm để thêm vào gian hàng.');
    }
    const take = Math.min(q.limit ?? 20, 50);
    const skip = ((q.page ?? 1) - 1) * take;
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        affiliateBlocked: false,
        // SELLER-15: sản phẩm đối tác chờ duyệt/bị từ chối gắn vào gian hàng thì khách không thấy — không mời CTV chọn.
        approvalStatus: 'APPROVED',
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ isFeatured: 'desc' }, { reviewCount: 'desc' }],
      take,
      skip,
      select: {
        id: true, name: true, slug: true, thumbnail: true, brand: true,
        basePrice: true, salePrice: true, ratingAvg: true, reviewCount: true, storefrontId: true,
        // CHỈ tính maxAffiliateRate trên variation đang bán (isActive) — variation ngừng bán
        // không được tính vào, tránh hiện %HH cao hơn thực tế CTV có thể đạt được.
        variations: { where: { isActive: true }, select: { affiliateRate: true, id: true, sku: true, retailPrice: true, salePrice: true, stock: true } },
      },
    });
    const defaultPct = await loadDefaultRate(this.config);
    return products.map((p) => {
      const { variations, storefrontId, ...rest } = p;
      return { ...rest, ...cardPrices(rest, variations), maxAffiliateRate: maxResolvedRate(variations, { storefrontId }, defaultPct) };
    });
  }

  async getPublicBySlug(identifier: string) {
    const clean = identifier.trim().toLowerCase();
    const visible = publicStorefrontWhere(await this.visibilityOptions());
    const sf = await this.prisma.storefront.findFirst({
      where: {
        // insensitive để gian hàng tạo TRƯỚC bản vá (slug in hoa) vẫn mở được mà không phải
        // chờ chạy migration hạ chữ — link CTV đã phát cho khách không được chết thêm ngày nào.
        OR: [
          { slug: { equals: clean, mode: 'insensitive' } },
          { subdomain: { equals: clean, mode: 'insensitive' } },
          { customDomain: { equals: clean, mode: 'insensitive' } },
        ],
        ...visible,
      },
      include: {
        owner: { select: { referralCode: true } },
        collections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            items: {
              orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }],
              include: {
                product: {
                  select: {
                    id: true, name: true, slug: true, thumbnail: true, brand: true,
                    basePrice: true, salePrice: true, ratingAvg: true, reviewCount: true, isActive: true,
                    affiliateBlocked: true, soldExternal: true, soldApp: true, approvalStatus: true, storefrontId: true,
                    // Chỉ để tính inStock (audit A4-06: lưới gian hàng chưa từng biết SP hết hàng
                    // hay chưa, ProductTile giờ cần cờ này để hiện overlay "tạm hết hàng").
                    variations: { where: { isActive: true }, select: { id: true, sku: true, retailPrice: true, salePrice: true, stock: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!sf) throw new NotFoundException('Gian hàng không tồn tại hoặc chưa đăng.');
    // Huy hiệu bậc CHỈ cho gian hàng CTV (bậc tính theo doanh số cá nhân — MERCHANT/BRAND không
    // có khái niệm này). CHỈ trả tên+icon (getPublicTier), không lộ doanh thu/bonusPct thật cho
    // khách xem gian hàng.
    // Gian hàng mẫu không mang nhãn tin cậy nào (bậc, duyệt, đối tác, kho): chỉ là minh hoạ, không phải người bán thật.
    const ownerTier =
      !sf.isSample && sf.type === 'CTV' && sf.ownerUserId ? await this.affiliate.getPublicTier(sf.ownerUserId) : null;
    return {
      id: sf.id,
      slug: sf.slug,
      // SELLER-4: mã giới thiệu lấy từ chủ gian hàng, không suy từ slug/subdomain trên URL (subdomain riêng không phải mã).
      referralCode: sf.type === 'CTV' ? (sf.owner?.referralCode ?? null) : null,
      ownerTier,
      ...withSubdomainFlag({ subdomain: sf.subdomain, customDomain: sf.customDomain }, await isStorefrontSubdomainEnabled(this.config)),
      type: sf.type,
      isPartner: !sf.isSample && isPartnerStore(sf),
      isSample: sf.isSample,
      // Tick xanh và nhãn "CTV tuyển chọn" chỉ dành cho gian hàng admin đã duyệt, dù cờ duyệt lần đầu bật hay tắt.
      approved: !sf.isSample && isStorefrontApproved(sf),
      title: sf.title,
      headerNote: sf.headerNote,
      avatarUrl: publicStorefrontImage(sf.id, 'avatar', sf.avatarUrl),
      coverUrl: publicStorefrontImage(sf.id, 'cover', sf.coverUrl),
      theme: sf.theme,
      themeColor: sf.themeColor ?? '#16a34a',
      // Kho gửi hàng chỉ có ở gian hàng đối tác tự giao; gian hàng CTV có thể còn dữ liệu cũ nhập nhầm (SELLER-8).
      ...(!sf.isSample && isPartnerStore(sf)
        ? {
            warehouseAddress: sf.warehouseAddress,
            warehouseCity: sf.warehouseCity,
            warehouseDistrict: sf.warehouseDistrict,
            warehouseWard: sf.warehouseWard,
            warehousePhone: sf.warehousePhone,
          }
        : {}),
      collections: sf.collections.map((c) => {
        const items = c.items.filter(
          (i) =>
            !i.isHidden &&
            i.product.isActive &&
            !i.product.affiliateBlocked &&
            (!i.product.approvalStatus || i.product.approvalStatus === 'APPROVED') &&
            // Hàng của gian hàng đối tác không được giảm combo (combo.service.ts) nên không hiện như một phần của combo.
            !(c.kind === 'COMBO' && isPartnerOwnedProduct(i.product)),
        );
        // Combo còn dưới MIN_COMBO_PRODUCTS sản phẩm khác nhau thì checkout không giảm (allocateComboDiscounts): không trả mức
        // giảm để trang gian hàng không hứa "Combo −X%".
        const comboLive = c.kind !== 'COMBO' || new Set(items.map((i) => i.product.id)).size >= MIN_COMBO_PRODUCTS;
        return {
          id: c.id, title: c.title, kind: c.kind, layout: c.layout, comboDiscountPct: comboLive ? c.comboDiscountPct : null,
          items: items.map((i) => ({
            id: i.id, note: i.note, variationId: i.variationId,
            product: {
              id: i.product.id, name: i.product.name, slug: i.product.slug, thumbnail: i.product.thumbnail,
              brand: i.product.brand, ...cardPrices(i.product, i.product.variations ?? []),
              ratingAvg: i.product.ratingAvg, reviewCount: i.product.reviewCount,
              sold: i.product.soldExternal + i.product.soldApp,
              inStock: (i.product.variations ?? []).some((v) => v.stock > 0),
            },
          })),
        };
      }),
    };
  }

  /**
   * Danh sách nhẹ gian hàng ĐÃ ĐĂNG cho web sitemap.ts — trước đây gian hàng/nhãn hàng chưa
   * được liệt kê trong sitemap vì "API công khai chưa có endpoint liệt kê chúng" (comment cũ
   * trong sitemap.ts). Giới hạn 500 gian hàng cập nhật gần nhất, mirror đúng cách sitemap.ts
   * đang giới hạn 200 sản phẩm — không cần crawler biết TOÀN BỘ, chỉ cần nội dung mới nhất.
   */
  async getPublicList() {
    const stores = await this.prisma.storefront.findMany({
      where: { ...publicStorefrontWhere(await this.visibilityOptions()), isSample: false },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return stores;
  }

  /** Byte ảnh base64 của gian hàng khách đang thấy; ảnh URL thường không qua đây (JSON trả thẳng URL). */
  async getPublicImage(id: string, kind: string, version: unknown): Promise<{ mime: string; data: Buffer; versionOk: boolean }> {
    const notFound = () => new NotFoundException('Không tìm thấy ảnh.');
    if (!isStorefrontImageKind(kind)) throw notFound();
    const sf = await this.prisma.storefront.findFirst({
      where: { id, ...publicStorefrontWhere(await this.visibilityOptions()) },
      select: { id: true, avatarUrl: true, coverUrl: true },
    });
    const image = kind === 'avatar' ? sf?.avatarUrl : sf?.coverUrl;
    const decoded = decodeServedImage(image);
    if (!sf || !image || !decoded) throw notFound();
    return { ...decoded, versionOk: matchesStorefrontImageVersion(version, sf.id, kind, image) };
  }

  async getPublicByHost(host: string) {
    // ?host=a&host=b đến đây là mảng (không phải chuỗi) nên không được gọi .split trên nó.
    if (typeof host !== 'string' || !host || host.length > HOST_MAX_LENGTH) throw new BadRequestException('Host không hợp lệ.');
    const hostname = host.split(':')[0]!.toLowerCase();
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const sub = parts[0]!;
      if (sub !== 'www' && sub !== 'admin' && sub !== 'api') {
        const bySub = await this.prisma.storefront.findFirst({
          where: {
            OR: [{ subdomain: sub }, { slug: sub }, { customDomain: hostname }],
            isPublished: true,
          },
        });
        if (bySub) return this.getPublicBySlug(bySub.slug);
      }
    }
    return this.getPublicBySlug(hostname);
  }

  /**
   * Thống kê theo sản phẩm cho chính CTV xem (không public) — CTV cần biết sản phẩm nào trong
   * gian hàng đang bán chạy để tối ưu, không chỉ số hoa hồng tổng đã có ở /affiliate/dashboard.
   * Gộp trực tiếp từ Order.storefrontSlug (đã có @@index sẵn) — không cần bảng đếm lượt xem/
   * click riêng, và không đụng logic tính hoa hồng (chỉ đọc, không tin cậy để trả tiền).
   *
   * Hoa hồng lấy từ bảng `Commission` (affiliateUserId + order.storefrontSlug), KHÔNG dùng cột
   * `Order.commission` — cột đó không nơi nào trong codebase ghi giá trị (mãi mãi = 0 mặc định
   * schema), affiliate.service.ts tự có bảng Commission riêng làm nguồn chân lý duy nhất cho
   * tiền hoa hồng (mirror dashboard()/storefrontAnalytics() cùng service).
   */
  async getStats(userId: string) {
    const sf = await this.assertOwnedStorefront(userId);
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [sales30d, sales7d, byProduct, commission30dAgg] = await Promise.all([
      storefrontSalesByStore(this.prisma, userId, [sf.slug], since30d),
      storefrontSalesByStore(this.prisma, userId, [sf.slug], since7d),
      storefrontSalesByProduct(this.prisma, userId, sf.slug, since30d),
      this.prisma.commission.aggregate({
        where: {
          affiliateUserId: userId,
          order: { storefrontSlug: sf.slug },
          createdAt: { gte: since30d },
          status: { not: 'REJECTED' },
        },
        _sum: { amount: true },
      }),
    ]);

    const revenue30d = Math.max(0, sales30d.get(sf.slug)?.revenue ?? 0);
    const lines = byProduct.filter((p) => p.qty > 0).sort((a, b) => b.revenue - a.revenue);
    return {
      orders7d: sales7d.get(sf.slug)?.orders ?? 0,
      orders30d: sales30d.get(sf.slug)?.orders ?? 0,
      revenue30d,
      commission30d: commission30dAgg._sum.amount ?? 0,
      byProduct: lines,
      // Doanh thu tính trên Order.total (gồm phí ship, trừ giảm giá cấp đơn và tiền hoàn thực tế) còn dòng sản phẩm tính trên
      // OrderItem.total trừ theo tỷ lệ số món trả: phần chênh (ship, giảm giá cấp đơn, chênh lệch tiền hoàn so với phần trừ theo
      // tỷ lệ) hiện thành một dòng riêng để các dòng cộng đúng ô Doanh thu. Có thể âm.
      shippingAndOrderDiscount30d: revenue30d - lines.reduce((t, p) => t + p.revenue, 0),
    };
  }

  private async assertOwnedStorefront(userId: string) {
    const sf = await this.prisma.storefront.findFirst({ where: { ownerUserId: userId, type: 'CTV' } });
    if (!sf) throw new NotFoundException('Chưa có gian hàng.');
    return sf;
  }

  async createCollection(
    userId: string,
    dto: { title: string; kind?: 'NORMAL' | 'COMBO'; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number },
  ) {
    const sf = await this.assertOwnedStorefront(userId);
    const comboDiscountPct = await this.clampComboPct(dto.comboDiscountPct);
    try {
      // count() rồi create() không atomic — 2 request tạo collection đồng thời (2 tab) có thể
      // cùng đọc count=N rồi cùng tạo sortOrder=N → 2 collection trùng sortOrder, thứ tự hiển thị
      // lộn xộn (không sai dữ liệu nghiêm trọng nhưng UX gian hàng bị xáo). Serializable buộc 1
      // trong 2 tx fail (P2034) thay vì âm thầm trùng (mirror users.service.ts createAddress).
      return await this.prisma.$transaction(
        async (tx) => {
          const count = await tx.storefrontCollection.count({ where: { storefrontId: sf.id } });
          if (count >= MAX_COLLECTIONS_PER_STORE) {
            throw new BadRequestException(`Mỗi gian hàng chỉ được tạo tối đa ${MAX_COLLECTIONS_PER_STORE} bộ sưu tập.`);
          }
          return tx.storefrontCollection.create({
            data: {
              storefrontId: sf.id,
              title: dto.title,
              kind: dto.kind ?? 'NORMAL',
              layout: dto.layout ?? 'CAROUSEL',
              comboDiscountPct: dto.kind === 'COMBO' ? comboDiscountPct ?? 0 : null,
              sortOrder: count,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận xử lý, vui lòng thử lại.');
      }
      throw err;
    }
  }

  /**
   * Áp mẫu dựng sẵn theo danh mục — tạo 1 collection + tối đa 8 sản phẩm nổi bật của danh mục
   * đó. Giảm ma sát cho CTV mới (trước đây gian hàng luôn trắng hoàn toàn, phải tự tạo từng
   * collection/sản phẩm). CHỈ áp dụng được khi gian hàng CHƯA có collection nào — tránh mẫu đè
   * lên gian hàng CTV đã tự dựng tay.
   */
  async applyTemplate(userId: string, categoryId: string) {
    const sf = await this.assertOwnedStorefront(userId);
    const category = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true } });
    if (!category) throw new BadRequestException('Danh mục không tồn tại.');
    const products = await this.prisma.product.findMany({
      // Như picker (SELLER-15, D3-16): món đối tác chờ duyệt/bị từ chối vào gian hàng thì khách không thấy.
      where: { categoryIds: { has: categoryId }, isActive: true, affiliateBlocked: false, approvalStatus: 'APPROVED' },
      orderBy: [{ isFeatured: 'desc' }, { reviewCount: 'desc' }],
      take: 8,
      select: { id: true },
    });
    if (products.length === 0) {
      throw new BadRequestException('Danh mục này chưa có sản phẩm gợi ý — hãy chọn danh mục khác hoặc tự tạo bộ sưu tập.');
    }
    try {
      // Serializable + đếm lại collection TRONG transaction (mirror createCollection) — chặn
      // race 2 request "áp mẫu" cùng lúc tạo 2 collection trùng cho cùng 1 gian hàng trống.
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.storefrontCollection.count({ where: { storefrontId: sf.id } });
          if (existing > 0) {
            throw new BadRequestException('Gian hàng đã có bộ sưu tập — mẫu chỉ áp dụng được cho gian hàng còn trống.');
          }
          const collection = await tx.storefrontCollection.create({
            data: { storefrontId: sf.id, title: category.name, kind: 'NORMAL', layout: 'CAROUSEL', sortOrder: 0 },
          });
          await tx.storefrontItem.createMany({
            data: products.map((p, i) => ({ collectionId: collection.id, productId: p.id, sortOrder: i })),
          });
          return { collectionId: collection.id, title: collection.title, itemCount: products.length };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận xử lý, vui lòng thử lại.');
      }
      throw err;
    }
  }

  async updateCollection(
    userId: string,
    collectionId: string,
    dto: { title?: string; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number },
  ) {
    await this.assertOwnedCollection(userId, collectionId);
    const comboDiscountPct = await this.clampComboPct(dto.comboDiscountPct);
    return this.prisma.storefrontCollection.update({
      where: { id: collectionId },
      data: { ...dto, ...(comboDiscountPct !== undefined ? { comboDiscountPct } : {}) },
    });
  }

  async deleteCollection(userId: string, collectionId: string) {
    await this.assertOwnedCollection(userId, collectionId);
    await this.prisma.storefrontCollection.delete({ where: { id: collectionId } });
    return { ok: true };
  }

  async reorderCollections(userId: string, orderedIds: string[]) {
    const sf = await this.assertOwnedStorefront(userId);
    const owned = await this.prisma.storefrontCollection.findMany({
      where: { storefrontId: sf.id }, select: { id: true }, orderBy: { sortOrder: 'asc' },
    });
    const ownedIds = owned.map((c) => c.id);
    const ownedSet = new Set(ownedIds);
    const included = orderedIds.filter((id) => ownedSet.has(id));
    const includedSet = new Set(included);
    // Collection sở hữu nhưng KHÔNG có trong orderedIds (payload thiếu) → nối vào cuối theo
    // đúng thứ tự sortOrder cũ, để KHÔNG bị bỏ sót và KHÔNG trùng sortOrder với phần vừa sắp lại.
    const remaining = ownedIds.filter((id) => !includedSet.has(id));
    const finalOrder = [...included, ...remaining];
    const ops = finalOrder.map((id, i) => this.prisma.storefrontCollection.update({ where: { id }, data: { sortOrder: i } }));
    await this.prisma.$transaction(ops);
    return { ok: true };
  }

  private async assertOwnedCollection(userId: string, collectionId: string) {
    const col = await this.prisma.storefrontCollection.findUnique({
      where: { id: collectionId },
      include: { storefront: true },
    });
    if (!col || !col.storefront || col.storefront.ownerUserId !== userId) throw new ForbiddenException('Không có quyền.');
    return col;
  }

  async addItem(
    userId: string,
    collectionId: string,
    dto: { productId: string; variationId?: string; note?: string },
  ) {
    const collection = await this.assertOwnedCollection(userId, collectionId);
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, name: true, isActive: true, affiliateBlocked: true, approvalStatus: true, storefrontId: true },
    });
    if (!product || !product.isActive || product.affiliateBlocked || product.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('Sản phẩm không khả dụng để thêm vào gian hàng.');
    }
    if (collection.kind === 'COMBO' && isPartnerOwnedProduct(product)) throw partnerGoodsError('COMBO', product.name);
    if (dto.variationId) {
      const variation = await this.prisma.variation.findUnique({
        where: { id: dto.variationId },
        select: { productId: true },
      });
      if (!variation || variation.productId !== dto.productId) {
        throw new BadRequestException('Biến thể không thuộc sản phẩm đã chọn.');
      }
    }
    try {
      // count() rồi create() không atomic — 2 request thêm item đồng thời vào CÙNG collection
      // (2 tab) có thể cùng đọc count=N rồi cùng tạo sortOrder=N → 2 item trùng sortOrder.
      // Serializable buộc 1 trong 2 tx fail (P2034) thay vì âm thầm trùng (mirror createCollection).
      return await this.prisma.$transaction(
        async (tx) => {
          const count = await tx.storefrontItem.count({ where: { collectionId } });
          if (count >= MAX_ITEMS_PER_COLLECTION) {
            throw new BadRequestException(`Mỗi bộ sưu tập chỉ được thêm tối đa ${MAX_ITEMS_PER_COLLECTION} sản phẩm.`);
          }
          return tx.storefrontItem.create({
            data: { collectionId, productId: dto.productId, variationId: dto.variationId ?? null, note: dto.note ?? null, sortOrder: count },
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  thumbnail: true,
                  brand: true,
                  basePrice: true,
                  salePrice: true,
                  ratingAvg: true,
                  reviewCount: true,
                  isActive: true,
                  affiliateBlocked: true,
                },
              },
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận xử lý, vui lòng thử lại.');
      }
      throw err;
    }
  }

  async updateItem(
    userId: string,
    itemId: string,
    dto: { note?: string; isPinned?: boolean; isHidden?: boolean },
  ) {
    await this.assertOwnedItem(userId, itemId);
    return this.prisma.storefrontItem.update({ where: { id: itemId }, data: dto });
  }

  async removeItem(userId: string, itemId: string) {
    await this.assertOwnedItem(userId, itemId);
    await this.prisma.storefrontItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  async reorderItems(userId: string, collectionId: string, orderedItemIds: string[]) {
    await this.assertOwnedCollection(userId, collectionId);
    const owned = await this.prisma.storefrontItem.findMany({
      where: { collectionId }, select: { id: true }, orderBy: { sortOrder: 'asc' },
    });
    const ownedIds = owned.map((i) => i.id);
    const ownedSet = new Set(ownedIds);
    const included = orderedItemIds.filter((id) => ownedSet.has(id));
    const includedSet = new Set(included);
    // Item sở hữu nhưng thiếu trong payload → nối cuối theo sortOrder cũ (tránh trùng sortOrder).
    const remaining = ownedIds.filter((id) => !includedSet.has(id));
    const finalOrder = [...included, ...remaining];
    const ops = finalOrder.map((id, i) => this.prisma.storefrontItem.update({ where: { id }, data: { sortOrder: i } }));
    await this.prisma.$transaction(ops);
    return { ok: true };
  }

  private async assertOwnedItem(userId: string, itemId: string) {
    const item = await this.prisma.storefrontItem.findUnique({
      where: { id: itemId },
      include: { collection: { include: { storefront: true } } },
    });
    if (!item || !item.collection || !item.collection.storefront || item.collection.storefront.ownerUserId !== userId) throw new ForbiddenException('Không có quyền.');
    return item;
  }
}
