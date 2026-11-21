import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PUBLIC_CACHE_POLICY_KEY } from '../../common/decorators/public-cache.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { CampaignsController } from './campaigns.controller';
import { CampaignListQuery } from './dto/campaign-query.dto';

const errors = (body: object) => validate(plainToInstance(CampaignListQuery, body));

describe('CampaignsController', () => {
  it.each(['list', 'publicSlugs', 'detail', 'products'] as const)('%s: công khai và cache CATALOG (không đọc JWT, không dữ liệu theo người)', (name) => {
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

  it('GET /campaigns/public-slugs khai TRƯỚC GET /campaigns/:slug: Express khớp theo thứ tự khai nên khai sau thì ":slug" nuốt mất và trả 404', () => {
    const proto = CampaignsController.prototype as unknown as Record<string, unknown>;
    const routes = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
      .map((name) => ({ name, path: Reflect.getMetadata(PATH_METADATA, proto[name] as object) as string | undefined }))
      .filter((r) => r.path !== undefined);
    const at = (path: string) => routes.findIndex((r) => r.path === path);
    expect(at('public-slugs')).toBeGreaterThanOrEqual(0);
    expect(at('public-slugs')).toBeLessThan(at(':slug'));
  });

  it('public-slugs gọi service, không nhận tham số nào từ người gọi', async () => {
    const svc = { listPublicSlugs: jest.fn().mockResolvedValue([{ slug: 'giua-thu', updatedAt: '2026-11-09T02:00:00.000Z' }]) };
    const c = new CampaignsController(svc as never);
    expect(CampaignsController.prototype.publicSlugs.length).toBe(0);
    await expect(c.publicSlugs()).resolves.toEqual([{ slug: 'giua-thu', updatedAt: '2026-11-09T02:00:00.000Z' }]);
    expect(svc.listPublicSlugs).toHaveBeenCalledWith();
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
