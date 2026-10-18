import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';
import { miniappRedirects } from './route-map';

describe('next.config redirects()', () => {
  it('đúng danh sách sinh từ route map, đều 307', async () => {
    const list = await nextConfig.redirects!();
    expect(list).toEqual(miniappRedirects());
    expect(list.every((r) => r.permanent === false)).toBe(true);
  });
});

describe('next.config CSP', () => {
  it('connect-src cho phép tải ảnh thẳng lên Cloudinary (đánh giá, minh chứng)', async () => {
    const rules = await nextConfig.headers!();
    const csp = rules.flatMap((r) => r.headers).find((h) => h.key === 'Content-Security-Policy-Report-Only')!.value;
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src '))!;
    expect(connect.split(' ')).toContain('https://api.cloudinary.com');
  });
});
