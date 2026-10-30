import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';
import { buildCatalogRedirects } from './catalog-redirects.mjs';
import { miniappRedirects } from './route-map';

describe('next.config redirects()', () => {
  it('chuyển hướng danh mục cũ của trang chủ rồi đến danh sách sinh từ route map, đều 307', async () => {
    const list = await nextConfig.redirects!();
    expect(list.slice(0, -1)).toEqual([...buildCatalogRedirects(), ...miniappRedirects()]);
    expect(list.slice(0, -1).every((r) => r.permanent === false)).toBe(true);
  });

  it('đường web đã xoá /cong-dong/xep-hang chuyển vĩnh viễn về /cong-dong', async () => {
    const list = await nextConfig.redirects!();
    expect(list).toContainEqual({ source: '/cong-dong/xep-hang', destination: '/cong-dong', permanent: true });
  });

  it('đường Mini App /feed/leaderboard và /refill đi cùng đích với bản chuyển hướng của Mini App', async () => {
    const list = await nextConfig.redirects!();
    expect(list).toContainEqual({ source: '/feed/leaderboard', destination: '/cong-dong', permanent: false });
    expect(list).toContainEqual({ source: '/refill', destination: '/doi-rac', permanent: false });
  });
});

describe('next.config CSP', () => {
  it('connect-src cho phép tải ảnh thẳng lên Cloudinary (đánh giá, minh chứng)', async () => {
    const rules = await nextConfig.headers!();
    const csp = rules.flatMap((r) => r.headers).find((h) => h.key === 'Content-Security-Policy-Report-Only')!.value;
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src '))!;
    expect(connect.split(' ')).toContain('https://api.cloudinary.com');
  });

  it('media-src cho video Cloudinary và blob: (xem trước, đo độ dài video trên máy), không rơi về default-src', async () => {
    const rules = await nextConfig.headers!();
    const csp = rules.flatMap((r) => r.headers).find((h) => h.key === 'Content-Security-Policy-Report-Only')!.value;
    const media = csp.split('; ').find((d) => d.startsWith('media-src '));
    expect(media?.split(' ')).toEqual(expect.arrayContaining(["'self'", 'blob:', 'https://res.cloudinary.com']));
  });
});
