import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { normalizeSubdomain, assertIdentifierAvailable } from './identifier-validation';

// Chặn CTV tạo vô hạn bộ sưu tập/sản phẩm trong 1 gian hàng (không ai cần vượt số này để
// bán hàng bình thường) — mirror MAX_WISHLIST_ITEMS ở wishlist.service.ts.
const MAX_COLLECTIONS_PER_STORE = 30;
const MAX_ITEMS_PER_COLLECTION = 100;

@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
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

  async getOrCreateMine(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'AFFILIATE' && user.role !== 'ADMIN') {
      throw new BadRequestException('Chỉ CTV mới tạo được gian hàng.');
    }
    const existing = await this.prisma.storefront.findFirst({ where: { ownerUserId: userId, type: 'CTV' } });
    if (existing) return existing;
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
          title: `Cửa hàng của ${user.fullName ?? 'bạn'}`,
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
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!sf) throw new NotFoundException('Chưa có gian hàng.');
    return sf;
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
    if (dto.subdomain) {
      const sub = normalizeSubdomain(dto.subdomain);
      // Kiểm trùng CHÉO cả slug/subdomain/customDomain — trước đây chỉ kiểm trùng subdomain-
      // với-subdomain, cho phép chiếm subdomain trùng SLUG của gian hàng khác (P0-1,
      // docs/2026-09-08-review-progress.md).
      await assertIdentifierAvailable(this.prisma, sub, sf.id);
      dto.subdomain = sub;
    }
    // Chuỗi rỗng = CHỦ ĐỘNG XOÁ → ghi null. FE gửi '' khi CTV xoá ảnh/lời nhắn (gửi undefined
    // thì PATCH bỏ qua trường đó, xoá xong ảnh cũ vẫn còn). Lưu '' thay vì null sẽ làm bẩn dữ
    // liệu và khiến điều kiện `Boolean(sf.avatarUrl && ...)` của nhiệm vụ hồ sơ đọc khó hiểu.
    const data: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v === undefined) continue;
      data[k] = typeof v === 'string' && v.trim() === '' ? null : v;
    }
    return this.prisma.storefront.update({ where: { id: sf.id }, data });
  }

  async publishMine(userId: string, isPublished: boolean) {
    const sf = await this.assertOwnedStorefront(userId);
    return this.prisma.storefront.update({
      where: { id: sf.id },
      data: { isPublished, publishedAt: isPublished ? new Date() : null },
    });
  }

  async pickerProducts(userId: string, q: { search?: string; page?: number; limit?: number }) {
    // Guardrail §9: picker trả maxAffiliateRate (% hoa hồng) → CHỈ CTV/Admin được gọi,
    // không lộ % hoa hồng cho khách thường.
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    if (user.role !== 'AFFILIATE' && user.role !== 'ADMIN') {
      throw new BadRequestException('Chỉ CTV mới xem được danh sách sản phẩm để thêm vào gian hàng.');
    }
    const take = Math.min(q.limit ?? 20, 50);
    const skip = ((q.page ?? 1) - 1) * take;
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        affiliateBlocked: false,
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ isFeatured: 'desc' }, { reviewCount: 'desc' }],
      take,
      skip,
      select: {
        id: true, name: true, slug: true, thumbnail: true, brand: true,
        basePrice: true, salePrice: true, ratingAvg: true, reviewCount: true,
        // CHỈ tính maxAffiliateRate trên variation đang bán (isActive) — variation ngừng bán
        // không được tính vào, tránh hiện %HH cao hơn thực tế CTV có thể đạt được.
        variations: { where: { isActive: true }, select: { affiliateRate: true } },
      },
    });
    return products.map((p) => {
      const { variations, ...rest } = p;
      return {
        ...rest,
        maxAffiliateRate: variations.reduce(
          (m, v) => Math.max(m, v.affiliateRate ? Number(v.affiliateRate) : 0), 0,
        ),
      };
    });
  }

  async getPublicBySlug(identifier: string) {
    const clean = identifier.trim().toLowerCase();
    const sf = await this.prisma.storefront.findFirst({
      where: {
        // insensitive để gian hàng tạo TRƯỚC bản vá (slug in hoa) vẫn mở được mà không phải
        // chờ chạy migration hạ chữ — link CTV đã phát cho khách không được chết thêm ngày nào.
        OR: [
          { slug: { equals: clean, mode: 'insensitive' } },
          { subdomain: { equals: clean, mode: 'insensitive' } },
          { customDomain: { equals: clean, mode: 'insensitive' } },
        ],
        isPublished: true,
      },
      include: {
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
                    affiliateBlocked: true, soldExternal: true, soldApp: true, approvalStatus: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!sf) throw new NotFoundException('Gian hàng không tồn tại hoặc chưa đăng.');
    return {
      id: sf.id,
      slug: sf.slug,
      subdomain: sf.subdomain,
      customDomain: sf.customDomain,
      type: sf.type,
      title: sf.title,
      headerNote: sf.headerNote,
      avatarUrl: sf.avatarUrl,
      coverUrl: sf.coverUrl,
      theme: sf.theme,
      themeColor: sf.themeColor ?? '#16a34a',
      bankName: sf.bankName,
      bankBin: sf.bankBin,
      bankAccountNo: sf.bankAccountNo,
      bankAccountName: sf.bankAccountName,
      warehouseAddress: sf.warehouseAddress,
      warehouseCity: sf.warehouseCity,
      warehouseDistrict: sf.warehouseDistrict,
      warehouseWard: sf.warehouseWard,
      warehousePhone: sf.warehousePhone,
      collections: sf.collections.map((c) => ({
        id: c.id, title: c.title, kind: c.kind, layout: c.layout, comboDiscountPct: c.comboDiscountPct,
        items: c.items
          .filter(
            (i) =>
              !i.isHidden &&
              i.product.isActive &&
              !i.product.affiliateBlocked &&
              (!i.product.approvalStatus || i.product.approvalStatus === 'APPROVED'),
          )
          .map((i) => ({
            id: i.id, note: i.note, variationId: i.variationId,
            product: {
              id: i.product.id, name: i.product.name, slug: i.product.slug, thumbnail: i.product.thumbnail,
              brand: i.product.brand, basePrice: i.product.basePrice, salePrice: i.product.salePrice,
              ratingAvg: i.product.ratingAvg, reviewCount: i.product.reviewCount,
              sold: i.product.soldExternal + i.product.soldApp,
            },
          })),
      })),
    };
  }

  async getPublicByHost(host: string) {
    if (!host) throw new BadRequestException('Host không hợp lệ.');
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
   */
  async getStats(userId: string) {
    const sf = await this.assertOwnedStorefront(userId);
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { storefrontSlug: sf.slug, status: { notIn: ['CANCELLED', 'RETURNED'] } },
      select: { createdAt: true, commission: true, items: { select: { productSlug: true, productName: true, quantity: true, total: true } } },
    });

    const byProduct = new Map<string, { productSlug: string; productName: string; qty: number; revenue: number }>();
    let orders30d = 0;
    let orders7d = 0;
    let revenue30d = 0;
    let commission30d = 0;
    for (const o of orders) {
      const in30d = o.createdAt >= since30d;
      const in7d = o.createdAt >= since7d;
      if (in30d) { orders30d += 1; revenue30d += o.items.reduce((s, i) => s + i.total, 0); commission30d += o.commission; }
      if (in7d) orders7d += 1;
      for (const item of o.items) {
        // Đơn cũ trước migration OrderItem.productSlug có thể null — gộp vào key riêng thay vì
        // vỡ thống kê hoặc lẫn với sản phẩm khác.
        const key = item.productSlug ?? `__unknown:${item.productName}`;
        const row = byProduct.get(key) ?? { productSlug: item.productSlug ?? '', productName: item.productName, qty: 0, revenue: 0 };
        row.qty += item.quantity;
        row.revenue += item.total;
        byProduct.set(key, row);
      }
    }

    return {
      orders7d,
      orders30d,
      revenue30d,
      commission30d,
      byProduct: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
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
    await this.assertOwnedCollection(userId, collectionId);
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, isActive: true, affiliateBlocked: true },
    });
    if (!product || !product.isActive || product.affiliateBlocked) {
      throw new BadRequestException('Sản phẩm không khả dụng để thêm vào gian hàng.');
    }
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
