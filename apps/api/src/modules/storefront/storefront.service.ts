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

  // helper dùng lại ở các task sau
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

  private async assertOwnedStorefront(userId: string) {
    const sf = await this.prisma.storefront.findFirst({ where: { ownerUserId: userId, type: 'CTV' } });
    if (!sf) throw new NotFoundException('Chưa có gian hàng.');
    return sf;
  }

  private async assertOwnedCollection(userId: string, collectionId: string) {
    const col = await this.prisma.storefrontCollection.findUnique({
      where: { id: collectionId },
      include: { storefront: true },
    });
    if (!col || col.storefront.ownerUserId !== userId) throw new ForbiddenException('Không có quyền.');
    return col;
  }

  private async assertOwnedItem(userId: string, itemId: string) {
    const item = await this.prisma.storefrontItem.findUnique({
      where: { id: itemId },
      include: { collection: { include: { storefront: true } } },
    });
    if (!item || item.collection.storefront.ownerUserId !== userId) throw new ForbiddenException('Không có quyền.');
    return item;
  }
}
