import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { OrderStatusService, toHttpBadRequest } from '../orders/order-status.service';
import { normalizeSubdomain, normalizeCustomDomain, assertIdentifierAvailable } from '../storefront/identifier-validation';

/** Số lần thử lại tối đa khi tạo gian hàng đụng race condition (P2002) trên subdomain. */
const MAX_CREATE_STORE_RETRY = 5;

const STORE_INCLUDE = {
  collections: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
  },
} satisfies Prisma.StorefrontInclude;

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface UpdateStoreDto {
  title?: string;
  headerNote?: string;
  subdomain?: string;
  customDomain?: string;
  themeColor?: string;
  bankName?: string;
  bankBin?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  warehouseAddress?: string;
  warehouseCity?: string;
  warehouseDistrict?: string;
  warehouseWard?: string;
  warehousePhone?: string;
  avatarUrl?: string;
  coverUrl?: string;
  isPublished?: boolean;
}

export interface CreateMerchantProductDto {
  name: string;
  description: string;
  shortDesc?: string;
  basePrice: number;
  salePrice?: number;
  images?: string[];
  thumbnail?: string;
  categoryIds?: string[];
  tags?: string[];
  forSegment?: string[];
  ingredients?: unknown;
  certifications?: string[];
  stock?: number;
}

@Injectable()
export class MerchantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatus: OrderStatusService,
  ) {}

  async getOrCreateStore(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'AFFILIATE' && user.role !== 'DEALER' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ tài khoản đối tác hoặc đại lý mới có quyền mở gian hàng.');
    }

    const store = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId },
      include: STORE_INCLUDE,
    });
    if (store) return store;

    const baseSlug = user.referralCode ? user.referralCode.toLowerCase() : `shop-${userId.slice(-6)}`;
    let subdomain = baseSlug;
    let counter = 1;
    while (await this.prisma.storefront.findUnique({ where: { subdomain } })) {
      subdomain = `${baseSlug}-${counter++}`;
    }

    // Bug 1 (race condition): findFirst rồi create phía trên KHÔNG transaction/lock — 2 request
    // đồng thời (double-tap "Mở gian hàng") có thể cùng đọc "chưa có store" rồi cùng create.
    // Từ khi có @@unique([ownerUserId]) (schema.prisma), request thua sẽ ăn P2002. Bug 2 (TOCTOU):
    // vòng lặp kiểm subdomain ở trên (findUnique rồi dùng ngay bên dưới) cũng có thể bị request
    // khác chiếm mất subdomain giữa lúc kiểm và lúc tạo, ăn P2002 trên cột subdomain.
    // Xử lý chung: bắt P2002, ưu tiên kiểm user đã có store chưa (dù P2002 rơi vào cột nào —
    // 2 request của CÙNG 1 user race nhau sẽ trùng CẢ 3 cột slug/subdomain/ownerUserId vì cùng
    // suy ra từ 1 baseSlug) — nếu có, đọc lại và trả về store request thắng vừa tạo thay vì throw.
    // Nếu không phải chính user này (bug 2: đụng subdomain của gian hàng KHÁC), đổi subdomain rồi
    // thử tạo lại thay vì để lỗi 409 chung chung.
    for (let attempt = 0; attempt <= MAX_CREATE_STORE_RETRY; attempt++) {
      try {
        return await this.prisma.storefront.create({
          data: {
            type: user.role === 'DEALER' ? 'MERCHANT' : 'CTV',
            slug: baseSlug,
            subdomain,
            ownerUserId: userId,
            title: `Gian hàng của ${user.fullName ?? 'Đối tác'}`,
            themeColor: '#16a34a',
            isPublished: true,
            publishedAt: new Date(),
            collections: {
              create: {
                title: 'Sản phẩm nổi bật',
                sortOrder: 0,
              },
            },
          },
          include: STORE_INCLUDE,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await this.prisma.storefront.findFirst({
            where: { ownerUserId: userId },
            include: STORE_INCLUDE,
          });
          if (existing) return existing;

          const target = Array.isArray(err.meta?.target) ? (err.meta?.target as string[]) : [];
          if (target.includes('subdomain') && attempt < MAX_CREATE_STORE_RETRY) {
            subdomain = `${baseSlug}-${counter++}`;
            continue;
          }
        }
        throw err;
      }
    }

    // Không thể tới đây trong thực tế (vòng for luôn return hoặc throw) — chỉ để TypeScript
    // thấy hàm luôn có giá trị trả về.
    throw new BadRequestException('Không thể tạo gian hàng, vui lòng thử lại.');
  }

  async updateStore(userId: string, dto: UpdateStoreDto) {
    const store = await this.getOrCreateStore(userId);

    const updateData: Prisma.StorefrontUpdateInput = {
      title: dto.title,
      headerNote: dto.headerNote,
      themeColor: dto.themeColor,
      bankName: dto.bankName,
      bankBin: dto.bankBin,
      bankAccountNo: dto.bankAccountNo,
      bankAccountName: dto.bankAccountName,
      warehouseAddress: dto.warehouseAddress,
      warehouseCity: dto.warehouseCity,
      warehouseDistrict: dto.warehouseDistrict,
      warehouseWard: dto.warehouseWard,
      warehousePhone: dto.warehousePhone,
      avatarUrl: dto.avatarUrl,
      coverUrl: dto.coverUrl,
    };

    if (dto.isPublished !== undefined) {
      updateData.isPublished = dto.isPublished;
      updateData.publishedAt = dto.isPublished ? new Date() : null;
    }

    if (dto.subdomain !== undefined) {
      const cleanSub = normalizeSubdomain(dto.subdomain);
      // Kiểm trùng CHÉO cả slug/subdomain/customDomain — trước đây chỉ kiểm trùng subdomain-
      // với-subdomain, cho phép CTV chiếm subdomain trùng SLUG của gian hàng khác (P0-1,
      // docs/2026-09-08-review-progress.md), từ đó lộ/giả mạo gian hàng qua các truy vấn OR
      // ở tầng đọc (vd bank-transfer.service.ts tra QR ngân hàng theo storefrontSlug).
      await assertIdentifierAvailable(this.prisma, cleanSub, store.id);
      updateData.subdomain = cleanSub;
    }

    if (dto.customDomain !== undefined) {
      if (dto.customDomain.trim() === '') {
        updateData.customDomain = null; // xoá tên miền riêng
      } else {
        // Trước đây KHÔNG có validate/kiểm trùng nào cho customDomain — ghi thẳng chuỗi bất kỳ,
        // kể cả trùng subdomain/slug của gian hàng khác (P0-1).
        const cleanDomain = normalizeCustomDomain(dto.customDomain);
        await assertIdentifierAvailable(this.prisma, cleanDomain, store.id);
        updateData.customDomain = cleanDomain;
      }
    }

    return this.prisma.storefront.update({
      where: { id: store.id },
      data: updateData,
    });
  }

  async publishStore(userId: string, isPublished: boolean) {
    const store = await this.getOrCreateStore(userId);
    return this.prisma.storefront.update({
      where: { id: store.id },
      data: { isPublished, publishedAt: isPublished ? new Date() : null },
    });
  }

  async createProduct(userId: string, dto: CreateMerchantProductDto) {
    const store = await this.getOrCreateStore(userId);

    const baseSlug = slugify(dto.name);
    const uniqueSlug = `${baseSlug}-${Date.now().toString(36)}`;
    const syntheticPancakeId = `MCH_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sku = `MCH-${Date.now().toString(36).toUpperCase()}`;

    // Tạo sản phẩm với trạng thái PENDING_REVIEW (chờ Admin kiểm duyệt)
    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        slug: uniqueSlug,
        pancakeId: syntheticPancakeId,
        brand: store.title,
        description: dto.description,
        shortDesc: dto.shortDesc,
        basePrice: dto.basePrice,
        salePrice: dto.salePrice ?? null,
        images: dto.images ?? [],
        thumbnail: dto.thumbnail ?? dto.images?.[0] ?? null,
        categoryIds: dto.categoryIds ?? [],
        tags: dto.tags ?? [],
        forSegment: dto.forSegment ?? [],
        ingredients: (dto.ingredients as Prisma.InputJsonValue) ?? undefined,
        certifications: dto.certifications ?? [],
        storefrontId: store.id,
        approvalStatus: 'PENDING_REVIEW',
        isActive: true,
        variations: {
          create: {
            pancakeId: `${syntheticPancakeId}_VAR`,
            sku,
            name: 'Mặc định',
            attributes: {},
            retailPrice: dto.basePrice,
            salePrice: dto.salePrice ?? null,
            stock: dto.stock ?? 100,
            isActive: true,
          },
        },
      },
      include: {
        variations: true,
      },
    });

    // Tự động gắn vào bộ sưu tập đầu tiên của gian hàng
    const defaultCollection = store.collections[0];
    if (defaultCollection) {
      const count = await this.prisma.storefrontItem.count({ where: { collectionId: defaultCollection.id } });
      await this.prisma.storefrontItem.create({
        data: {
          collectionId: defaultCollection.id,
          productId: product.id,
          sortOrder: count,
        },
      });
    }

    return product;
  }

  // Bug 3: trước đây không có take/skip — merchant đăng quá `limit` mặc định của DB không bao
  // giờ xem hết được sản phẩm của chính mình (và danh sách bán lại). Nay phân trang thật, dùng
  // chung page/limit cho cả 2 danh sách (own + resell) vì cả 2 đến từ 1 request/1 màn hình.
  async listMyProducts(userId: string, page = 1, limit = 20) {
    const store = await this.getOrCreateStore(userId);
    const { skip, take } = skipTake(page, limit);

    const ownWhere: Prisma.ProductWhereInput = { storefrontId: store.id };
    const resellWhere: Prisma.StorefrontItemWhereInput = {
      collection: { storefrontId: store.id },
      product: { storefrontId: { not: store.id } },
    };

    // 1. Sản phẩm do merchant tự đăng
    // 2. Sản phẩm Tubu Tree chọn bán lại (thông qua StorefrontItem)
    const [ownTotal, ownProducts, resellTotal, resellItems] = await Promise.all([
      this.prisma.product.count({ where: ownWhere }),
      this.prisma.product.findMany({
        where: ownWhere,
        orderBy: { createdAt: 'desc' },
        include: { variations: true },
        skip,
        take,
      }),
      this.prisma.storefrontItem.count({ where: resellWhere }),
      this.prisma.storefrontItem.findMany({
        where: resellWhere,
        include: {
          product: {
            include: { variations: true },
          },
        },
        skip,
        take,
      }),
    ]);

    return {
      ownProducts,
      resellProducts: resellItems.map((item) => item.product),
      meta: { page, limit, ownTotal, resellTotal },
    };
  }

  async addResellProduct(userId: string, productId: string, collectionId?: string) {
    const store = await this.getOrCreateStore(userId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true, approvalStatus: true },
    });
    if (!product || !product.isActive || product.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('Sản phẩm không khả dụng để bán lại.');
    }

    const targetColId = collectionId ?? store.collections[0]?.id;
    if (!targetColId) {
      throw new BadRequestException('Gian hàng chưa có bộ sưu tập sản phẩm.');
    }
    // IDOR (P1-1, docs/2026-09-08-review-progress.md): collectionId đến từ body — trước đây
    // KHÔNG kiểm nó thuộc CHÍNH gian hàng của caller. Id collection của gian hàng khác lộ qua
    // trang public (GET /storefront/public/:slug trả collections[].id), đủ để chèn sản phẩm
    // thẳng vào gian hàng người khác. store.collections đã include sẵn ở getOrCreateStore.
    if (collectionId && !store.collections.some((c) => c.id === collectionId)) {
      throw new BadRequestException('Bộ sưu tập không thuộc gian hàng của bạn.');
    }

    const existing = await this.prisma.storefrontItem.findFirst({
      where: { collectionId: targetColId, productId },
    });
    if (existing) return existing;

    const count = await this.prisma.storefrontItem.count({ where: { collectionId: targetColId } });
    return this.prisma.storefrontItem.create({
      data: {
        collectionId: targetColId,
        productId,
        sortOrder: count,
      },
    });
  }

  async removeResellProduct(userId: string, productId: string) {
    const store = await this.getOrCreateStore(userId);
    await this.prisma.storefrontItem.deleteMany({
      where: {
        collection: { storefrontId: store.id },
        productId,
      },
    });
    return { ok: true };
  }

  // Bug 4: logic xác định đơn nào thuộc quyền quản lý của merchant (theo storefrontSlug/
  // subdomain HOẶC theo variationId sản phẩm của gian hàng) trước đây bị copy-paste y hệt giữa
  // listMerchantOrders và updateMerchantOrderStatus — đây là biến kiểm soát truy cập, sửa 1 chỗ
  // quên chỗ kia sẽ rò rỉ/quyền truy cập lệch nhau. Gom về 1 hàm dùng chung cho cả 2 nơi.
  //
  // orConditions rỗng (gian hàng chưa có slug lẫn sản phẩm nào) → trả `OR: []`, Prisma coi mảng
  // OR rỗng là điều kiện LUÔN SAI (ngược với AND rỗng luôn ĐÚNG) nên count/findMany/findFirst
  // ghép thêm where này đều tự nhiên ra rỗng — nơi gọi không cần biết chi tiết cách dựng OR.
  private async resolveMerchantOrderFilter(userId: string): Promise<Prisma.OrderWhereInput> {
    const store = await this.getOrCreateStore(userId);

    const storeProducts = await this.prisma.product.findMany({
      where: { storefrontId: store.id },
      select: { variations: { select: { id: true } } },
    });
    const merchantVariationIds = storeProducts.flatMap((p) => p.variations.map((v) => v.id));

    const slugs = [store.slug, store.subdomain].filter(Boolean) as string[];
    const orConditions: Prisma.OrderWhereInput[] = [];
    if (slugs.length > 0) {
      orConditions.push({ storefrontSlug: { in: slugs } });
    }
    if (merchantVariationIds.length > 0) {
      orConditions.push({
        items: {
          some: {
            variationId: { in: merchantVariationIds },
          },
        },
      });
    }

    return { OR: orConditions };
  }

  // Bug 3: `take: 50` không kèm `skip` — merchant có trên 50 đơn không bao giờ xem được đơn cũ
  // hơn. Nay phân trang thật kèm meta {total, page, limit}.
  async listMerchantOrders(userId: string, status?: string, page = 1, limit = 20) {
    const filter = await this.resolveMerchantOrderFilter(userId);
    const where: Prisma.OrderWhereInput = {
      ...filter,
      ...(status ? { status: status as never } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          user: {
            select: { id: true, fullName: true, phone: true },
          },
        },
        ...skipTake(page, limit),
      }),
    ]);

    return paginated(data, page, limit, total);
  }

  async updateMerchantOrderStatus(userId: string, orderId: string, status: string) {
    const ALLOWED = ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'];
    if (!ALLOWED.includes(status)) {
      throw new BadRequestException(`Trạng thái "${status}" không hợp lệ.`);
    }

    const filter = await this.resolveMerchantOrderFilter(userId);

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        ...filter,
      },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng thuộc quyền quản lý của bạn.');

    // Trước đây ghi status trực tiếp — không guard transition (DELIVERED có thể bị lùi về
    // CONFIRMED rồi khách tự hủy lại, hoàn tiền/restock lần 2 trên đơn đã giao — P0-1) VÀ
    // không cộng/đảo điểm Xanh + hoa hồng CTV (đơn CTV tự đổi DELIVERED/CANCELLED không bao
    // giờ credit/reverse — mất vĩnh viễn, P1-1). Ủy quyền cho OrderStatusService — cùng nguồn
    // ghi status với admin/pancake. Xem docs/2026-09-08-review-progress.md.
    try {
      return await this.orderStatus.setStatus(order.id, status as OrderStatus, {
        actorType: 'MERCHANT',
        actorId: userId,
      });
    } catch (err) {
      toHttpBadRequest(err);
    }
  }
}
