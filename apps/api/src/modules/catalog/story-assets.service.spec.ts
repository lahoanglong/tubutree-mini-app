import dns from 'dns';
import sharp from 'sharp';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { assertPublicHttpUrl, StoryAssetsService } from './story-assets.service';

const png = (w = 8, h = 6, bg = '#ffffff') => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();
const imgRes = async (body?: Buffer, type = 'image/png') => new Response(new Uint8Array(body ?? (await png())), { status: 200, headers: { 'content-type': type } });
const htmlRes = (html: string) => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

let lookup: jest.SpyInstance;
let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  fetchSpy = jest.spyOn(globalThis, 'fetch');
});
afterEach(() => jest.restoreAllMocks());

describe('assertPublicHttpUrl', () => {
  it.each(['http://127.0.0.1/a.png', 'http://10.1.2.3/a.png', 'http://172.20.0.1/a.png', 'http://192.168.1.1/a.png', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/a.png', 'http://localhost/a.png', 'http://[fe80::1]/a.png', 'http://[fd00::1]/a.png'])(
    'rejects 127.0.0.1, 10.x, 169.254.169.254, [::1], localhost: %s',
    async (url) => {
      await expect(assertPublicHttpUrl(url)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rejects ipv4-mapped ipv6 private', async () => {
    await expect(assertPublicHttpUrl('http://[::ffff:127.0.0.1]/a.png')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPublicHttpUrl('http://[::ffff:10.0.0.1]/a.png')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects host that resolves to private ip', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }] as never);
    const err = await assertPublicHttpUrl('https://evil.example.com/a.png').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String(err.message)).not.toContain('10.0.0.5');
  });

  it('rejects odd ports, non-http schemes and accepts a public https url', async () => {
    await expect(assertPublicHttpUrl('https://example.com:8443/a.png')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPublicHttpUrl('ftp://example.com/a.png')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPublicHttpUrl('not a url')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPublicHttpUrl('https://example.com/a.png')).resolves.toBeInstanceOf(URL);
  });
});

function setup(product: unknown = { id: 'p1' }) {
  const prisma = { product: { findUnique: jest.fn().mockResolvedValue(product) } };
  return { svc: new StoryAssetsService(prisma as never), prisma };
}

describe('StoryAssetsService.extract', () => {
  it('404 when product missing', async () => {
    const { svc } = setup(null);
    await expect(svc.extract('x', { imageUrls: ['https://example.com/a.png'] })).rejects.toBeInstanceOf(NotFoundException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires pageUrl or imageUrls', async () => {
    await expect(setup().svc.extract('p1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects redirect to private ip', async () => {
    lookup.mockImplementation((async (host: string) => [{ address: host === 'internal.test' ? '10.0.0.9' : '93.184.216.34', family: 4 }]) as never);
    fetchSpy.mockResolvedValueOnce(redirect('http://internal.test/secret.png'));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/a.png'] });
    expect(out.images).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects more than 2 redirects', async () => {
    fetchSpy.mockImplementation(async () => redirect('https://example.com/next.png'));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/a.png'] });
    expect(out.images).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('follows up to 2 redirects', async () => {
    fetchSpy.mockResolvedValueOnce(redirect('https://example.com/b.png')).mockResolvedValueOnce(redirect('https://example.com/c.png')).mockResolvedValueOnce(await imgRes());
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/a.png'] });
    expect(out.images).toEqual([{ url: 'https://example.com/c.png', width: 8, height: 6 }]);
  });

  it('rejects non-image content-type', async () => {
    fetchSpy.mockResolvedValueOnce(await imgRes(await png(), 'text/html'));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/a.png'] });
    expect(out.images).toEqual([]);
  });

  it('rejects image over 8MB', async () => {
    fetchSpy.mockResolvedValueOnce(await imgRes(Buffer.alloc(8 * 1024 * 1024 + 1, 1)));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/big.png'] });
    expect(out.images).toEqual([]);
  });

  it('rejects an undecodable image', async () => {
    fetchSpy.mockResolvedValueOnce(await imgRes(Buffer.from('not an image')));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/bad.png'] });
    expect(out.images).toEqual([]);
  });

  it('returns images with matching webp cutouts, shrinking above 1600px before cutting', async () => {
    fetchSpy.mockResolvedValueOnce(await imgRes(await png(2000, 100, '#202020')));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/wide.png'] });
    expect(out.images).toEqual([{ url: 'https://example.com/wide.png', width: 2000, height: 100 }]);
    expect(out.cutouts).toHaveLength(1);
    expect(out.cutouts[0]?.sourceUrl).toBe('https://example.com/wide.png');
    expect(out.cutouts[0]?.dataUrl.startsWith('data:image/webp;base64,')).toBe(true);
    const meta = await sharp(Buffer.from(out.cutouts[0]!.dataUrl.split(',')[1]!, 'base64')).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
  });

  it('pageUrl extraction returns og:image and img src as absolute https, max 12', async () => {
    const imgs = Array.from({ length: 15 }, (_, i) => `<img alt="" src="/p/${i}.png">`).join('');
    const html = `<html><head><meta content="//cdn.example.com/og.png" property="og:image"></head><body>${imgs}<img src="/p/0.png"><img src="data:image/png;base64,AAA"></body></html>`;
    fetchSpy.mockImplementation(async (u: unknown) => (String(u) === 'https://shop.example.com/sp' ? htmlRes(html) : await imgRes()));
    const out = await setup().svc.extract('p1', { pageUrl: 'https://shop.example.com/sp' });
    expect(out.images).toHaveLength(12);
    expect(out.images[0]?.url).toBe('https://cdn.example.com/og.png');
    expect(out.images[1]?.url).toBe('https://shop.example.com/p/0.png');
    expect(out.images.every((i) => i.url.startsWith('https://'))).toBe(true);
    expect(new Set(out.images.map((i) => i.url)).size).toBe(12);
  });

  it('rejects a pageUrl that is not html', async () => {
    fetchSpy.mockResolvedValueOnce(await imgRes());
    await expect(setup().svc.extract('p1', { pageUrl: 'https://shop.example.com/sp' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bad image in list is skipped, others returned', async () => {
    fetchSpy.mockResolvedValueOnce(await imgRes(Buffer.from('junk'))).mockResolvedValueOnce(await imgRes());
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/bad.png', 'https://example.com/ok.png'] });
    expect(out.images.map((i) => i.url)).toEqual(['https://example.com/ok.png']);
    expect(out.cutouts.map((c) => c.sourceUrl)).toEqual(['https://example.com/ok.png']);
  });
});
