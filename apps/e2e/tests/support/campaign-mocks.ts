import type { CampaignBanner, CampaignDetail } from '../../../../packages/app-core/src/api/campaign';
import { CATALOG, toCard } from './discovery-mocks';
import { reply, type MockApi } from './mock-api';

const DAY = 86_400_000;

/** Ảnh banner 5:2 dạng data-URI SVG: không đi qua mạng, nên không có lần tải ảnh nào làm sai số đo bố cục. */
export function bannerImage(label: string, color = '#2f6b4f'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="600" viewBox="0 0 1500 600"><rect width="1500" height="600" fill="${color}"/><text x="750" y="320" font-size="96" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function campaignBanner(slug: string, over: Partial<CampaignBanner> = {}): CampaignBanner {
  return {
    id: `cp-${slug}`,
    slug,
    title: `Chiến dịch ${slug}`,
    image: bannerImage(slug),
    linkType: 'CAMPAIGN_PAGE',
    linkValue: null,
    audience: 'ALL',
    startAt: new Date(Date.now() - DAY).toISOString(),
    endAt: new Date(Date.now() + 10 * DAY).toISOString(),
    ...over,
  };
}

export const CAMPAIGN_SLUG = 'giua-thu';
export const CAMPAIGN_TITLE = 'Giữa Thu';
export const CAMPAIGN_CODE = 'THU10';

export function campaignDetail(over: Partial<CampaignDetail> = {}): CampaignDetail {
  return {
    ...campaignBanner(CAMPAIGN_SLUG, { title: CAMPAIGN_TITLE }),
    subtitle: 'Giảm sâu mùa trăng',
    productCount: 3,
    coupons: [{ code: CAMPAIGN_CODE, type: 'PERCENT', value: 10, minOrder: 100_000, maxDiscount: 30_000, endAt: new Date(Date.now() + 5 * DAY).toISOString() }],
    ...over,
  };
}

export interface CampaignMockOptions {
  home?: CampaignBanner[];
  offers?: CampaignBanner[];
  /** Theo slug; slug không có → 404 (hết hạn, chưa mở hay không có). */
  details?: Record<string, CampaignDetail>;
  /** Giữ câu trả lời của `GET /campaigns` tới khi promise này xong: dữ liệu về muộn để đo độ nhảy bố cục. */
  hold?: Promise<void>;
}

/** `GET /campaigns?placement=`, `/campaigns/:slug`, `/campaigns/:slug/products` đúng dạng API thật. Mặc định của mock-api là không có chiến dịch. */
export function mockCampaigns(api: MockApi, o: CampaignMockOptions = {}): void {
  api.get('/campaigns', async ({ call }) => {
    await o.hold;
    const placement = call.query.get('placement');
    return placement === 'HOME_TOP' ? (o.home ?? []) : placement === 'OFFERS_TOP' ? (o.offers ?? []) : [];
  });
  api.get('/campaigns/:slug', ({ params }) => o.details?.[params.slug!] ?? reply(404, { statusCode: 404, error: 'Not Found', message: 'Không tìm thấy chiến dịch.' }));
  api.get('/campaigns/:slug/products', ({ call }) => {
    const page = Number(call.query.get('page') ?? '1');
    const limit = Number(call.query.get('limit') ?? '20');
    const all = CATALOG.slice(0, 3).map(toCard);
    return { data: all.slice((page - 1) * limit, page * limit), meta: { page, limit, total: all.length } };
  });
}
