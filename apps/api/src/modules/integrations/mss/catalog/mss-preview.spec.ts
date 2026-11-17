import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { MssFlagsService } from '../mss-flags';
import { MssRequestError, type MssClient } from '../mss.client';
import { MSS_PREVIEW_EXPIRED, MssPreviewService } from './mss-preview';
import { MSS_PREVIEW_TTL_S, signMssPreviewToken } from './mss-preview-token';

const HOST = 'mss.example.test';
const SECRET = 's'.repeat(43);
const nowS = () => Math.floor(Date.now() / 1000);
const token = (over: Partial<{ pid: string; ver: number; exp: number }> = {}, secret = SECRET) =>
  signMssPreviewToken({ pid: 'a1', ver: 8, exp: nowS() + MSS_PREVIEW_TTL_S, ...over }, secret);

const draft = (pid = 'a1', enrichment: Record<string, unknown> = {}) => ({
  pancake_product_id: pid,
  mss_product_id: 'm1',
  state: 'preview',
  published_version: 8,
  updated_at: '2026-11-17T01:00:00Z',
  enrichment: {
    title: 'Tựa nháp',
    images: [{ url: `https://${HOST}/api/pub/catalog-media/draft0001.webp?token=abcdefghijklmnop.qrst`, alt: null, w: null, h: null, variation_id: null }],
    category_slugs: ['giat'],
    ...enrichment,
  },
});

function setup(opts: { respond?: () => unknown; configured?: boolean; product?: { slug: string } | null; categories?: { id: string }[] } = {}) {
  const request = jest.fn(async () => ({ status: 200, data: (opts.respond ?? (() => draft()))(), durationMs: 1 }));
  const flags = {
    env: () => ({ inboundSecret: SECRET, inboundSecretPrev: null }),
    configured: () => opts.configured ?? true,
  } as unknown as MssFlagsService;
  const prisma = {
    product: { findUnique: jest.fn().mockResolvedValue(opts.product === undefined ? { slug: 'nuoc-giat' } : opts.product) },
    category: { findMany: jest.fn().mockResolvedValue(opts.categories ?? [{ id: 'cat-giat' }]) },
  } as unknown as PrismaService;
  const getBySlug = jest.fn(async (slug: string, o: { enrichment: { title: string | null } }) => ({ slug, name: o.enrichment.title ?? 'Tubu', basePrice: 195_000 }));
  const moduleRef = { get: jest.fn(() => ({ getBySlug })) } as unknown as ModuleRef;
  return { svc: new MssPreviewService(prisma, flags, { request } as unknown as MssClient, moduleRef), request, getBySlug };
}

const OLD_ENV = process.env.MSS_BASE_URL;
beforeAll(() => {
  process.env.MSS_BASE_URL = `https://${HOST}`;
});
afterAll(() => {
  process.env.MSS_BASE_URL = OLD_ENV;
});

describe('MssPreviewService.product', () => {
  it('token đúng: lấy bản nháp từ MSS, ghép lên PDP Tubu (không lưu), kèm phiên bản và hạn', async () => {
    const f = setup();
    const t = token();
    const r = await f.svc.product(t);
    expect(f.request).toHaveBeenCalledWith('GET', `/catalog/preview?token=${encodeURIComponent(t)}`, expect.anything());
    expect(r).toMatchObject({ slug: 'nuoc-giat', name: 'Tựa nháp', basePrice: 195_000, preview: { version: 8 } });
    const passed = f.getBySlug.mock.calls[0]?.[1].enrichment as unknown as { categoryIds: string[]; images: { url: string }[] };
    expect(passed.categoryIds).toEqual(['cat-giat']);
    expect(passed.images[0]?.url).toContain('?token=');
  });

  it.each([
    ['sai dạng', () => 'abc.def'],
    ['hết hạn', () => token({ exp: nowS() - 600 })],
    ['không có token', () => undefined],
  ])('token %s: 404 mà không gọi MSS', async (_l, make) => {
    const f = setup();
    await expect(f.svc.product(make())).rejects.toMatchObject({ response: MSS_PREVIEW_EXPIRED });
    expect(f.request).not.toHaveBeenCalled();
  });

  it('chữ ký token do MSS kiểm: token đúng dạng ký bằng khoá lạ được chuyển sang MSS, MSS từ chối thì 404 hết hạn', async () => {
    const f = setup({
      respond: () => {
        throw new MssRequestError('unauthorized', 'x', { status: 401 });
      },
    });
    await expect(f.svc.product(token({}, 'khoa-gia-mao'.repeat(4)))).rejects.toMatchObject({ response: MSS_PREVIEW_EXPIRED });
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('phản hồi chỉ gồm trường công khai của PDP (không lộ cột nội bộ)', async () => {
    const f = setup();
    f.getBySlug.mockResolvedValueOnce({ slug: 'nuoc-giat', name: 'Tựa nháp', basePrice: 195_000, approvalStatus: 'APPROVED', storefrontId: 's1', soldApp: 3 } as never);
    const r = (await f.svc.product(token())) as Record<string, unknown>;
    expect(r).toMatchObject({ slug: 'nuoc-giat', name: 'Tựa nháp', preview: { version: 8 } });
    expect(r).not.toHaveProperty('approvalStatus');
    expect(r).not.toHaveProperty('storefrontId');
    expect(r).not.toHaveProperty('soldApp');
  });

  it('sản phẩm có trên Tubu nhưng đang ẩn/chờ duyệt (PDP công khai 404): báo not_found, không phải hết hạn', async () => {
    const f = setup();
    f.getBySlug.mockRejectedValueOnce(new NotFoundException('Không tìm thấy sản phẩm.'));
    await expect(f.svc.product(token())).rejects.toMatchObject({ response: { error: 'not_found' } });
  });

  it('chưa cấu hình MSS: 404, không gọi', async () => {
    const f = setup({ configured: false });
    await expect(f.svc.product(token())).rejects.toBeInstanceOf(NotFoundException);
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each([401, 404, 410])('MSS trả %i (token bị thu hồi/hết hạn ở MSS): 404', async (status) => {
    const f = setup({
      respond: () => {
        throw new MssRequestError(status === 401 ? 'unauthorized' : 'client_error', 'x', { status });
      },
    });
    await expect(f.svc.product(token())).rejects.toMatchObject({ response: MSS_PREVIEW_EXPIRED });
  });

  it('MSS lỗi máy chủ: 503', async () => {
    const f = setup({
      respond: () => {
        throw new MssRequestError('server_error', 'x', { status: 500 });
      },
    });
    await expect(f.svc.product(token())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('MSS trả bản nháp của sản phẩm khác token: 503, không hiện nội dung sai sản phẩm', async () => {
    const f = setup({ respond: () => draft('khac') });
    await expect(f.svc.product(token())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.getBySlug).not.toHaveBeenCalled();
  });

  it('MSS trả tài liệu đã xuất bản thay vì bản nháp: 503', async () => {
    const f = setup({ respond: () => ({ ...draft(), state: 'published' }) });
    await expect(f.svc.product(token())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sản phẩm chưa có ở Tubu: 404 not_found', async () => {
    const f = setup({ product: null });
    await expect(f.svc.product(token())).rejects.toMatchObject({ response: { error: 'not_found' } });
  });

  it('slug danh mục không có ở Tubu: giữ danh mục Tubu', async () => {
    const f = setup({ categories: [] });
    await f.svc.product(token());
    expect((f.getBySlug.mock.calls[0]?.[1].enrichment as unknown as { categoryIds: unknown }).categoryIds).toBeNull();
  });
});
