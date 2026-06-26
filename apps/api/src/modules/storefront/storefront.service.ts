import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateMine(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'AFFILIATE' && user.role !== 'ADMIN') {
      throw new BadRequestException('Chỉ CTV mới tạo được gian hàng.');
    }
    const existing = await this.prisma.storefront.findFirst({ where: { ownerUserId: userId, type: 'CTV' } });
    if (existing) return existing;
    return this.prisma.storefront.create({
      data: {
        type: 'CTV',
        slug: user.referralCode,
        ownerUserId: userId,
        title: `Cửa hàng của ${user.fullName ?? 'bạn'}`,
      },
    });
  }

  async getMine(userId: string) {
    const sf = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId, type: 'CTV' },
      include: {
        collections: {
          orderBy: { sortOrder: 'asc' },
          include: { items: { orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }] } },
        },
      },
    });
    if (!sf) throw new NotFoundException('Chưa có gian hàng.');
    return sf;
  }

  async updateMine(
    userId: string,
    dto: { title?: string; headerNote?: string; avatarUrl?: string; coverUrl?: string; theme?: string },
  ) {
    const sf = await this.assertOwnedStorefront(userId);
    return this.prisma.storefront.update({ where: { id: sf.id }, data: dto });
  }

  async publishMine(userId: string, isPublished: boolean) {
    const sf = await this.assertOwnedStorefront(userId);
    return this.prisma.storefront.update({
      where: { id: sf.id },
      data: { isPublished, publishedAt: isPublished ? new Date() : null },
    });
  }

  async pickerProducts(_userId: string, q: { search?: string; page?: number; limit?: number }) {
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
        variations: { select: { affiliateRate: true } },
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

  async getPublicBySlug(slug: string) {
    const sf = await this.prisma.storefront.findFirst({
      where: { slug, isPublished: true },
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
      id: sf.id, slug: sf.slug, type: sf.type, title: sf.title, headerNote: sf.headerNote,
      avatarUrl: sf.avatarUrl, coverUrl: sf.coverUrl, theme: sf.theme,
      collections: sf.collections.map((c) => ({
        id: c.id, title: c.title, kind: c.kind, layout: c.layout, comboDiscountPct: c.comboDiscountPct,
        items: c.items
          .filter((i) => !i.isHidden && i.product.isActive)
          .map((i) => ({
            id: i.id, note: i.note, variationId: i.variationId,
            product: {
              id: i.product.id, name: i.product.name, slug: i.product.slug, thumbnail: i.product.thumbnail,
              brand: i.product.brand, basePrice: i.product.basePrice, salePrice: i.product.salePrice,
              ratingAvg: i.product.ratingAvg, reviewCount: i.product.reviewCount,
            },
          })),
      })),
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
    const count = await this.prisma.storefrontCollection.count({ where: { storefrontId: sf.id } });
    return this.prisma.storefrontCollection.create({
      data: {
        storefrontId: sf.id,
        title: dto.title,
        kind: dto.kind ?? 'NORMAL',
        layout: dto.layout ?? 'CAROUSEL',
        comboDiscountPct: dto.kind === 'COMBO' ? dto.comboDiscountPct ?? 0 : null,
        sortOrder: count,
      },
    });
  }

  async updateCollection(
    userId: string,
    collectionId: string,
    dto: { title?: string; layout?: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number },
  ) {
    await this.assertOwnedCollection(userId, collectionId);
    return this.prisma.storefrontCollection.update({ where: { id: collectionId }, data: dto });
  }

  async deleteCollection(userId: string, collectionId: string) {
    await this.assertOwnedCollection(userId, collectionId);
    await this.prisma.storefrontCollection.delete({ where: { id: collectionId } });
    return { ok: true };
  }

  async reorderCollections(userId: string, orderedIds: string[]) {
    const sf = await this.assertOwnedStorefront(userId);
    const owned = await this.prisma.storefrontCollection.findMany({
      where: { storefrontId: sf.id }, select: { id: true },
    });
    const ownedSet = new Set(owned.map((c) => c.id));
    const ops = orderedIds
      .filter((id) => ownedSet.has(id))
      .map((id, i) => this.prisma.storefrontCollection.update({ where: { id }, data: { sortOrder: i } }));
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
    const count = await this.prisma.storefrontItem.count({ where: { collectionId } });
    return this.prisma.storefrontItem.create({
      data: { collectionId, productId: dto.productId, variationId: dto.variationId ?? null, note: dto.note ?? null, sortOrder: count },
    });
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
    const owned = await this.prisma.storefrontItem.findMany({ where: { collectionId }, select: { id: true } });
    const ownedSet = new Set(owned.map((i) => i.id));
    const ops = orderedItemIds
      .filter((id) => ownedSet.has(id))
      .map((id, i) => this.prisma.storefrontItem.update({ where: { id }, data: { sortOrder: i } }));
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
