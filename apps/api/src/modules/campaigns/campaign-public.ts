import type { Campaign, CampaignAudience, CampaignLinkType, CampaignPlacement, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { publicImage } from '../../common/public-image';

// Lấy dư số slide tối đa của carousel (5): app-core còn lọc đối tượng/lịch lần nữa trên máy khách nên cần chừa chỗ.
export const BANNER_FETCH_LIMIT = 10;

export interface CampaignBannerDTO {
  id: string;
  slug: string;
  title: string;
  image: string;
  linkType: CampaignLinkType;
  linkValue: string | null;
  audience: CampaignAudience;
  startAt: string;
  endAt: string;
}

type BannerRow = Pick<Campaign, 'id' | 'slug' | 'title' | 'image' | 'linkType' | 'linkValue' | 'audience' | 'startAt' | 'endAt'>;

/** Đang chạy: bật, đã tới `startAt` và chưa tới `endAt` (đúng lúc `endAt` là đã hết). Mốc là tức thời UTC nên "giờ VN" do admin nhập đã đổi sẵn. */
export function liveWhere(now: Date, placement?: CampaignPlacement): Prisma.CampaignWhereInput {
  return { ...(placement ? { placement } : {}), isActive: true, startAt: { lte: now }, endAt: { gt: now } };
}

/** Khách NEW thấy ALL + NEW, khách RETURNING thấy ALL + RETURNING; không biết loại khách thì không lọc. */
export function audienceWhere(wanted?: 'NEW' | 'RETURNING'): Prisma.CampaignWhereInput {
  return wanted ? { audience: { in: ['ALL', wanted] } } : {};
}

/** Ảnh banner phục vụ được (hoặc null) cho `toBannerDTO`. Kiểm sức khoẻ không gọi hàm này mà phân loại 32 ký tự đầu ảnh ở DB, theo cùng danh sách mime (`served-image.ts`). */
export const bannerImage = (id: string, image: string | null | undefined): string | null => publicImage('campaign', id, 'cover', image);

/** Banner công khai; null khi ảnh không phục vụ được (rỗng, SVG, base64 hỏng): bỏ chiến dịch đó thay vì để lọt một slide trống. */
export function toBannerDTO(c: BannerRow): CampaignBannerDTO | null {
  const image = bannerImage(c.id, c.image);
  if (!image) return null;
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    image,
    linkType: c.linkType,
    linkValue: c.linkValue,
    audience: c.audience,
    startAt: c.startAt.toISOString(),
    endAt: c.endAt.toISOString(),
  };
}

const BANNER_ORDER_BY: Prisma.CampaignOrderByWithRelationInput[] = [{ sortOrder: 'asc' }, { startAt: 'desc' }, { id: 'asc' }];

/** Thứ tự hiển thị banner (`orderBy` của listLiveBanners viết thành hàm so sánh): sortOrder tăng, startAt mới trước, id tăng. */
export function compareBannerOrder(a: { id: string; sortOrder: number; startAt: Date }, b: { id: string; sortOrder: number; startAt: Date }): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.startAt.getTime() !== b.startAt.getTime()) return b.startAt.getTime() - a.startAt.getTime();
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function listLiveBanners(
  prisma: Pick<PrismaService, 'campaign'>,
  placement: CampaignPlacement,
  opts: { now?: Date; audience?: 'NEW' | 'RETURNING' } = {},
): Promise<CampaignBannerDTO[]> {
  const rows = await prisma.campaign.findMany({
    where: { ...liveWhere(opts.now ?? new Date(), placement), ...audienceWhere(opts.audience) },
    orderBy: BANNER_ORDER_BY,
    take: BANNER_FETCH_LIMIT,
    select: { id: true, slug: true, title: true, image: true, linkType: true, linkValue: true, audience: true, startAt: true, endAt: true },
  });
  return rows.map(toBannerDTO).filter((b): b is CampaignBannerDTO => b !== null);
}

/** Trần số slug cho sitemap: chiến dịch đang chạy cùng lúc chỉ vài chục, trần này chỉ để bảo vệ máy chủ (cùng mức 500 với sản phẩm và gian hàng của sitemap). */
export const PUBLIC_SLUGS_LIMIT = 500;

export interface CampaignSlugDTO {
  slug: string;
  /** Lần admin sửa gần nhất, dùng làm `lastmod` của sitemap. */
  updatedAt: string;
}

/**
 * Slug các trang /chien-dich/<slug> đang mở cho khách, cho sitemap web. Chỉ chiến dịch đang chạy (`liveWhere`) có trang riêng (`CAMPAIGN_PAGE`):
 * banner trỏ sản phẩm, danh mục hay màn nội bộ không có lối nào dẫn tới trang chiến dịch nên không nộp. Chỉ trả slug và ngày sửa, dựng lại từng
 * dòng thay vì trả thẳng dòng DB, để không lộ id, tiêu đề, mã giảm giá hay bản nháp.
 */
export async function listPublicCampaignSlugs(prisma: Pick<PrismaService, 'campaign'>, now: Date = new Date()): Promise<CampaignSlugDTO[]> {
  const rows = await prisma.campaign.findMany({
    where: { ...liveWhere(now), linkType: 'CAMPAIGN_PAGE' },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: PUBLIC_SLUGS_LIMIT,
    select: { slug: true, updatedAt: true },
  });
  return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
}
