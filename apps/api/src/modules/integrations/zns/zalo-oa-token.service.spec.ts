jest.mock('axios');
import axios from 'axios';
import { ZaloOaTokenService } from './zalo-oa-token.service';
import { computeExpiresAt } from './zalo-oa-token.util';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';

const post = axios.post as jest.Mock;

function makeConfig(over: Record<string, string> = {}): ConfigService<Env, true> {
  const map: Record<string, string> = {
    ZALO_OAUTH_BASE: 'https://oauth.zaloapp.com',
    ZALO_APP_ID: 'app1',
    ZALO_APP_SECRET: 'sec1',
    ZALO_OA_ACCESS_TOKEN: 'env-access',
    ZALO_OA_REFRESH_TOKEN: 'env-refresh',
    ...over,
  };
  return { get: (k: string) => map[k] } as unknown as ConfigService<Env, true>;
}

function makePrisma(store: Record<string, string> = {}) {
  const systemConfig = {
    findUnique: jest.fn(async ({ where: { key } }: { where: { key: string } }) =>
      key in store ? { value: store[key] } : null,
    ),
    upsert: jest.fn(async ({ where: { key }, update, create }: { where: { key: string }; update: { value: string }; create: { value: string } }) => {
      store[key] = update?.value ?? create?.value;
      return {};
    }),
  };
  return { prisma: { systemConfig } as unknown as PrismaService, store, systemConfig };
}

const NOW = new Date('2026-06-26T00:00:00Z');

beforeEach(() => post.mockReset());

describe('ZaloOaTokenService.refresh', () => {
  it('thiếu refresh_token (env rỗng + chưa lưu) → false, không gọi Zalo', async () => {
    const { prisma } = makePrisma();
    const svc = new ZaloOaTokenService(prisma, makeConfig({ ZALO_OA_REFRESH_TOKEN: '' }));
    expect(await svc.refresh(NOW)).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('refresh thành công → LƯU access + refresh MỚI (xoay vòng) + hạn', async () => {
    post.mockResolvedValue({ data: { access_token: 'new-acc', refresh_token: 'new-ref', expires_in: 90000 } });
    const { prisma, store } = makePrisma();
    const svc = new ZaloOaTokenService(prisma, makeConfig());
    expect(await svc.refresh(NOW)).toBe(true);
    expect(store['zalo.oa_access_token']).toBe('new-acc');
    expect(store['zalo.oa_refresh_token']).toBe('new-ref'); // refresh_token mới được lưu
    expect(store['zalo.oa_token_expires_at']).toBe(computeExpiresAt(90000, NOW));
    // dùng refresh_token từ env cho lần bootstrap
    expect(post.mock.calls[0][1]).toContain('refresh_token=env-refresh');
  });

  it('response thiếu token → false, không lưu', async () => {
    post.mockResolvedValue({ data: { message: 'invalid refresh token' } });
    const { prisma, store } = makePrisma();
    const svc = new ZaloOaTokenService(prisma, makeConfig());
    expect(await svc.refresh(NOW)).toBe(false);
    expect(store['zalo.oa_access_token']).toBeUndefined();
  });

  it('refresh_token đã lưu (xoay vòng trước đó) được ưu tiên hơn env', async () => {
    post.mockResolvedValue({ data: { access_token: 'a2', refresh_token: 'r2', expires_in: 90000 } });
    const { prisma } = makePrisma({ 'zalo.oa_refresh_token': 'stored-ref' });
    const svc = new ZaloOaTokenService(prisma, makeConfig());
    await svc.refresh(NOW);
    expect(post.mock.calls[0][1]).toContain('refresh_token=stored-ref');
  });
});

describe('ZaloOaTokenService.refreshIfNeeded', () => {
  it('token còn hạn dài → KHÔNG refresh', async () => {
    const future = new Date(NOW.getTime() + 20 * 3600 * 1000).toISOString();
    const { prisma } = makePrisma({ 'zalo.oa_token_expires_at': future });
    const svc = new ZaloOaTokenService(prisma, makeConfig());
    expect(await svc.refreshIfNeeded(NOW)).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('token sắp hết hạn → refresh', async () => {
    post.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r', expires_in: 90000 } });
    const soon = new Date(NOW.getTime() + 1 * 3600 * 1000).toISOString();
    const { prisma } = makePrisma({ 'zalo.oa_token_expires_at': soon });
    const svc = new ZaloOaTokenService(prisma, makeConfig());
    expect(await svc.refreshIfNeeded(NOW)).toBe(true);
    expect(post).toHaveBeenCalled();
  });
});

describe('ZaloOaTokenService.getAccessToken', () => {
  it('ưu tiên token đã lưu, fallback env', async () => {
    const a = makePrisma({ 'zalo.oa_access_token': 'stored-acc' });
    expect(await new ZaloOaTokenService(a.prisma, makeConfig()).getAccessToken()).toBe('stored-acc');
    const b = makePrisma();
    expect(await new ZaloOaTokenService(b.prisma, makeConfig()).getAccessToken()).toBe('env-access');
  });
});
