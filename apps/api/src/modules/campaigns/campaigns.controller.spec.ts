import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PUBLIC_CACHE_POLICY_KEY } from '../../common/decorators/public-cache.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { CampaignsController } from './campaigns.controller';
import { CampaignListQuery } from './dto/campaign-query.dto';

const errors = (body: object) => validate(plainToInstance(CampaignListQuery, body));

describe('CampaignsController', () => {
  it.each(['list', 'detail', 'products'] as const)('%s: công khai và cache CATALOG (không đọc JWT, không dữ liệu theo người)', (name) => {
    const handler = CampaignsController.prototype[name];
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, handler)).toBe('CATALOG');
  });

  it('chuyển placement + audience xuống service, slug và phân trang cho chi tiết/sản phẩm', async () => {
    const svc = { listPublic: jest.fn().mockResolvedValue([]), getPublic: jest.fn().mockResolvedValue({}), getProducts: jest.fn().mockResolvedValue({}) };
    const c = new CampaignsController(svc as never);
    await c.list({ placement: 'HOME_TOP', audience: 'NEW' });
    expect(svc.listPublic).toHaveBeenCalledWith('HOME_TOP', 'NEW');
    await c.detail('giua-thu');
    expect(svc.getPublic).toHaveBeenCalledWith('giua-thu');
    await c.products('giua-thu', { page: 2, limit: 20 });
    expect(svc.getProducts).toHaveBeenCalledWith('giua-thu', 2, 20);
  });
});

describe('CampaignListQuery', () => {
  it('placement bắt buộc và chỉ nhận HOME_TOP / OFFERS_TOP; audience tuỳ chọn NEW / RETURNING', async () => {
    expect(await errors({ placement: 'HOME_TOP' })).toHaveLength(0);
    expect(await errors({ placement: 'OFFERS_TOP', audience: 'RETURNING' })).toHaveLength(0);
    expect(await errors({})).not.toHaveLength(0);
    expect(await errors({ placement: 'BROWSE_TOP' })).not.toHaveLength(0);
    expect(await errors({ placement: 'HOME_TOP', audience: 'ALL' })).not.toHaveLength(0);
  });
});
