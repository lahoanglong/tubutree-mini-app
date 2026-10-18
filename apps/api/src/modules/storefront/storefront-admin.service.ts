import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginated, skipTake } from '../../common/pagination';
import { isStorefrontApprovalRequired } from './storefront-config';
import { isStorefrontApproved, ownerHiddenReason, type PublicVisibilityOptions } from './storefront-visibility';

export type StorefrontStatusFilter = 'PUBLISHED' | 'DRAFT' | 'TAKEN_DOWN' | 'PENDING_APPROVAL';
export type StorefrontTypeFilter = 'CTV' | 'BRAND' | 'MERCHANT';

export interface StorefrontAdminListQuery {
  page: number;
  limit: number;
  status?: StorefrontStatusFilter;
  type?: StorefrontTypeFilter;
  q?: string;
}

/** Danh sách không kéo ảnh bìa/avatar: ở gian hàng thiếu Cloudinary chúng là base64 tới 1,5MB mỗi ảnh. */
const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  type: true,
  isPartner: true,
  isPublished: true,
  publishedAt: true,
  approvedAt: true,
  takenDownAt: true,
  takenDownReason: true,
  createdAt: true,
  updatedAt: true,
  ownerUserId: true,
  owner: { select: { id: true, fullName: true, phone: true, role: true, isBlocked: true } },
  collections: { select: { _count: { select: { items: true } } } },
} satisfies Prisma.StorefrontSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  headerNote: true,
  avatarUrl: true,
  coverUrl: true,
  theme: true,
  themeColor: true,
  subdomain: true,
  approvedById: true,
  takenDownById: true,
  collections: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      title: true,
      kind: true,
      items: {
        orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }],
        select: {
          id: true,
          note: true,
          isHidden: true,
          isPinned: true,
          product: { select: { id: true, name: true, slug: true, thumbnail: true } },
        },
      },
    },
  },
} satisfies Prisma.StorefrontSelect;

const REASON_MAX = 300;

const itemsOf = (collections: { _count: { items: number } }[]) => collections.reduce((n, c) => n + c._count.items, 0);

/**
 * Kiểm duyệt gian hàng cho admin (D3-02): danh sách có lọc, xem chi tiết, duyệt lần đầu (tick xanh), gỡ đăng kèm lý do và
 * đăng lại. Mỗi thao tác là MỘT lệnh updateMany có điều kiện trạng thái trong WHERE nên hai admin bấm cùng lúc, hay chủ đăng
 * chen giữa, chỉ một bên thắng và chỉ một tin báo chủ được gửi.
 */
@Injectable()
export class StorefrontAdminService {
  private readonly logger = new Logger(StorefrontAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly affiliate: AffiliateService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async list(q: StorefrontAdminListQuery) {
    const where = this.listWhere(q);
    const { skip, take } = skipTake(q.page, q.limit);
    const [rows, total, opts] = await Promise.all([
      this.prisma.storefront.findMany({ where, select: LIST_SELECT, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip, take }),
      this.prisma.storefront.count({ where }),
      this.visibilityOptions(),
    ]);
    return paginated(rows.map(({ collections, ...r }) => this.summary(r, opts, itemsOf(collections))), q.page, q.limit, total);
  }

  async detail(id: string) {
    const [row, opts] = await Promise.all([
      this.prisma.storefront.findUnique({ where: { id }, select: DETAIL_SELECT }),
      this.visibilityOptions(),
    ]);
    if (!row) throw new NotFoundException('Không tìm thấy gian hàng.');
    const { collections, ...rest } = row;
    const itemCount = collections.reduce((n, c) => n + c.items.length, 0);
    return {
      ...this.summary(rest, opts, itemCount),
      collections: collections.map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        items: c.items.map((i) => ({
          id: i.id,
          note: i.note,
          isHidden: i.isHidden,
          isPinned: i.isPinned,
          productId: i.product.id,
          productName: i.product.name,
          productSlug: i.product.slug,
          productThumbnail: i.product.thumbnail,
        })),
      })),
    };
  }

  async takeDown(adminId: string, id: string, rawReason: string) {
    const reason = (rawReason ?? '').trim();
    if (!reason) throw new BadRequestException('Cần nhập lý do gỡ đăng để báo chủ gian hàng.');
    if (reason.length > REASON_MAX) throw new BadRequestException(`Lý do tối đa ${REASON_MAX} ký tự.`);
    const { count } = await this.prisma.storefront.updateMany({
      where: { id, takenDownAt: null },
      data: { isPublished: false, takenDownAt: new Date(), takenDownReason: reason, takenDownById: adminId },
    });
    const sf = await this.summaryOf(id);
    if (count === 1) {
      this.logger.warn(`Admin ${adminId} gỡ đăng gian hàng ${id} (chủ ${sf.ownerUserId ?? 'không có'}): ${reason}`);
      await this.notifyOwner(sf.ownerUserId, 'STOREFRONT_TAKEN_DOWN', { store: sf.title, reason });
    }
    return sf;
  }

  async reinstate(adminId: string, id: string) {
    const cleared = { takenDownAt: null, takenDownReason: null, takenDownById: null };
    // Đã từng đăng (publishedAt còn) thì hiện lại; bị gỡ khi còn nháp thì vẫn là nháp. Chủ không đăng được khi đang bị gỡ nên
    // publishedAt không thể chuyển từ null sang có giữa hai lệnh.
    let { count } = await this.prisma.storefront.updateMany({
      where: { id, takenDownAt: { not: null }, publishedAt: { not: null } },
      data: { ...cleared, isPublished: true },
    });
    if (count === 0) {
      ({ count } = await this.prisma.storefront.updateMany({ where: { id, takenDownAt: { not: null }, publishedAt: null }, data: cleared }));
    }
    const sf = await this.summaryOf(id);
    if (count === 1) {
      this.logger.warn(`Admin ${adminId} đăng lại gian hàng ${id} (chủ ${sf.ownerUserId ?? 'không có'}).`);
      // Tin nói "hiển thị lại với khách" nên chỉ gửi khi khách thật sự thấy: gian hàng nháp, chủ bị khoá hoặc mất vai trò CTV vẫn ẩn.
      if (sf.publicVisible) await this.notifyOwner(sf.ownerUserId, 'STOREFRONT_REINSTATED', { store: sf.title });
    }
    return sf;
  }

  async setApproved(adminId: string, id: string, approved: boolean) {
    const { count } = approved
      ? await this.prisma.storefront.updateMany({ where: { id, approvedAt: null }, data: { approvedAt: new Date(), approvedById: adminId } })
      : await this.prisma.storefront.updateMany({ where: { id, approvedAt: { not: null } }, data: { approvedAt: null, approvedById: null } });
    const sf = await this.summaryOf(id);
    if (count === 1) {
      this.logger.warn(`Admin ${adminId} ${approved ? 'duyệt' : 'bỏ duyệt'} gian hàng ${id}.`);
      if (approved) await this.notifyOwner(sf.ownerUserId, 'STOREFRONT_APPROVED', { store: sf.title });
    }
    return sf;
  }

  private listWhere(q: StorefrontAdminListQuery): Prisma.StorefrontWhereInput {
    const and: Prisma.StorefrontWhereInput[] = [];
    if (q.status === 'PUBLISHED') and.push({ isPublished: true, takenDownAt: null });
    else if (q.status === 'DRAFT') and.push({ isPublished: false, takenDownAt: null });
    else if (q.status === 'TAKEN_DOWN') and.push({ takenDownAt: { not: null } });
    else if (q.status === 'PENDING_APPROVAL') and.push({ isPublished: true, takenDownAt: null, type: 'CTV', isPartner: false, approvedAt: null });
    if (q.type) and.push({ type: q.type });
    const term = q.q?.trim();
    if (term) {
      const like = { contains: term, mode: 'insensitive' as const };
      and.push({
        OR: [
          { title: like },
          { slug: like },
          { subdomain: like },
          { owner: { fullName: like } },
          { owner: { phone: { contains: term } } },
        ],
      });
    }
    return { AND: and };
  }

  private async summaryOf(id: string) {
    const [row, opts] = await Promise.all([this.prisma.storefront.findUnique({ where: { id }, select: LIST_SELECT }), this.visibilityOptions()]);
    if (!row) throw new NotFoundException('Không tìm thấy gian hàng.');
    const { collections, ...rest } = row;
    return this.summary(rest, opts, itemsOf(collections));
  }

  private summary(row: Omit<Prisma.StorefrontGetPayload<{ select: typeof LIST_SELECT }>, 'collections'>, opts: PublicVisibilityOptions, itemCount: number) {
    const { owner, ...rest } = row;
    const hiddenReason = row.isPublished || row.takenDownAt ? ownerHiddenReason(row, owner, opts) : null;
    return {
      ...rest,
      approved: isStorefrontApproved(row),
      itemCount,
      // Khách thấy gian hàng này ngay bây giờ không: đã đăng và không có lý do nào ẩn.
      publicVisible: row.isPublished && !hiddenReason,
      hiddenReason,
      owner,
    };
  }

  private async visibilityOptions() {
    const [roles, requireApproval] = await Promise.all([this.affiliate.commissionEligibleRoles(), isStorefrontApprovalRequired(this.config)]);
    return { eligibleRoles: [...roles], requireApproval };
  }

  /** Báo chủ gian hàng; lỗi thông báo không được làm hỏng việc admin đã làm. */
  private async notifyOwner(ownerUserId: string | null, template: string, data: Record<string, string>) {
    if (!ownerUserId || !this.notifications) return;
    await this.notifications
      .notify(ownerUserId, template, data)
      .catch((e: unknown) => this.logger.warn(`Báo chủ gian hàng ${template} lỗi: ${e instanceof Error ? e.message : e}`));
  }
}
