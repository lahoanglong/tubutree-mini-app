import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatusService, toHttpBadRequest } from '../orders/order-status.service';
import { normalizeSubdomain, normalizeCustomDomain, assertIdentifierAvailable } from '../storefront/identifier-validation';

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

    let store = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId },
      include: {
        collections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            items: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!store) {
      const baseSlug = user.referralCode ? user.referralCode.toLowerCase() : `shop-${userId.slice(-6)}`;
      let subdomain = baseSlug;
      let counter = 1;
      while (await this.prisma.storefront.findUnique({ where: { subdomain } })) {
        subdomain = `${baseSlug}-${counter++}`;
      }

      store = await this.prisma.storefront.create({
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
        include: {
          collections: {
            include: {
              items: {
                include: { product: true },
              },
            },
          },
        },
      });
    }

    return store;
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

  async listMyProducts(userId: string) {
    const store = await this.getOrCreateStore(userId);

    // 1. Sản phẩm do merchant tự đăng
    const ownProducts = await this.prisma.product.findMany({
      where: { storefrontId: store.id },
      orderBy: { createdAt: 'desc' },
      include: { variations: true },
    });

    // 2. Sản phẩm Tubu Tree chọn bán lại (thông qua StorefrontItem)
    const resellItems = await this.prisma.storefrontItem.findMany({
      where: {
        collection: { storefrontId: store.id },
        product: { storefrontId: { not: store.id } },
      },
      include: {
        product: {
          include: { variations: true },
        },
      },
    });

    return {
      ownProducts,
      resellProducts: resellItems.map((item) => item.product),
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

  async listMerchantOrders(userId: string, status?: string) {
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
    if (orConditions.length === 0) {
      return [];
    }

    return this.prisma.order.findMany({
      where: {
        OR: orConditions,
        ...(status ? { status: status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        user: {
          select: { id: true, fullName: true, phone: true },
        },
      },
      take: 50,
    });
  }

  async updateMerchantOrderStatus(userId: string, orderId: string, status: string) {
    const ALLOWED = ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'];
    if (!ALLOWED.includes(status)) {
      throw new BadRequestException(`Trạng thái "${status}" không hợp lệ.`);
    }

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
    if (orConditions.length === 0) {
      throw new NotFoundException('Không tìm thấy đơn hàng thuộc quyền quản lý của bạn.');
    }

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: orConditions,
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
