import type { Campaign, CampaignAudience, CampaignLinkType, CampaignPlacement, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { publicImage } from '../../common/public-image';
import { CAMPAIGN_ENTITY_SLUG_RE, CAMPAIGN_INTERNAL_TARGETS } from '@tubutree/shared-types';

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

/**
 * Đích có dựng được link ở app không: cùng điều kiện với `campaignHref` của app-core (dùng chung hằng của shared-types, API không import app-core).
 * Không xét liveRoute: nó chỉ đổi route khi một tính năng tắt, không biến link thành null.
 */
export function bannerLinkUsable(c: Pick<Campaign, 'linkType' | 'linkValue'>): boolean {
  switch (c.linkType) {
    case 'CAMPAIGN_PAGE':
      return true;
    case 'PRODUCT':
    case 'CATEGORY':
      return !!c.linkValue && CAMPAIGN_ENTITY_SLUG_RE.test(c.linkValue);
    case 'URL_INTERNAL':
      return CAMPAIGN_INTERNAL_TARGETS.some((t) => t.value === c.linkValue);
    default:
      return false;
  }
}

/** Ảnh banner phục vụ được (hoặc null): một chỗ cho `toBannerDTO` và cho phép kiểm sức khoẻ biết chiến dịch nào thật sự ra slide. */
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
