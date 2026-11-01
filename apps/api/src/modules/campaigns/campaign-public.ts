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

/** Banner công khai; null khi ảnh không phục vụ được (rỗng, SVG, base64 hỏng): bỏ chiến dịch đó thay vì để lọt một slide trống. */
export function toBannerDTO(c: BannerRow): CampaignBannerDTO | null {
  const image = publicImage('campaign', c.id, 'cover', c.image);
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

export async function listLiveBanners(
  prisma: Pick<PrismaService, 'campaign'>,
  placement: CampaignPlacement,
  opts: { now?: Date; audience?: 'NEW' | 'RETURNING' } = {},
): Promise<CampaignBannerDTO[]> {
  const rows = await prisma.campaign.findMany({
    where: { ...liveWhere(opts.now ?? new Date(), placement), ...audienceWhere(opts.audience) },
    orderBy: [{ sortOrder: 'asc' }, { startAt: 'desc' }, { id: 'asc' }],
    take: BANNER_FETCH_LIMIT,
    select: { id: true, slug: true, title: true, image: true, linkType: true, linkValue: true, audience: true, startAt: true, endAt: true },
  });
  return rows.map(toBannerDTO).filter((b): b is CampaignBannerDTO => b !== null);
}
