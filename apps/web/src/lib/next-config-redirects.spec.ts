import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';
import { buildCatalogRedirects } from './catalog-redirects.mjs';
import { miniappRedirects } from './route-map';
import { CSP_REPORT_GROUP, buildCsp, cspReportUrl } from './csp.mjs';

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

describe('CSP gửi báo cáo vi phạm về API', () => {
  const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `));

  it('report-uri và Reporting-Endpoints cùng trỏ POST /api/csp-report của API, report-to gọi đúng tên endpoint', () => {
    const { policy, reportingEndpoints } = buildCsp({ apiBaseUrl: 'https://api.tubutree.com/api' });
    expect(directive(policy, 'report-uri')).toBe('report-uri https://api.tubutree.com/api/csp-report');
    expect(directive(policy, 'report-to')).toBe(`report-to ${CSP_REPORT_GROUP}`);
    expect(reportingEndpoints).toBe(`${CSP_REPORT_GROUP}="https://api.tubutree.com/api/csp-report"`);
  });

  it('URL API có dấu / cuối hoặc query thì đường báo cáo vẫn đúng', () => {
    expect(cspReportUrl('https://api.tubutree.com/api/')).toBe('https://api.tubutree.com/api/csp-report');
    expect(cspReportUrl('https://api.tubutree.com/api?x=1')).toBe('https://api.tubutree.com/api/csp-report');
  });

  it('URL API rỗng, tương đối hoặc không phải http(s) thì không có report-uri, report-to và Reporting-Endpoints', () => {
    for (const apiBaseUrl of [undefined, '', '/api', 'javascript:alert(1)']) {
      const { policy, reportingEndpoints } = buildCsp({ apiBaseUrl });
      expect(directive(policy, 'report-uri'), String(apiBaseUrl)).toBeUndefined();
      expect(directive(policy, 'report-to'), String(apiBaseUrl)).toBeUndefined();
      expect(reportingEndpoints, String(apiBaseUrl)).toBe('');
      expect(directive(policy, 'connect-src'), String(apiBaseUrl)).toBe("connect-src 'self' https://api.cloudinary.com");
    }
  });

  it("bản production không cho 'unsafe-eval', bản dev (next dev chạy mã qua eval) thì có", () => {
    const prod = directive(buildCsp({ apiBaseUrl: 'https://api.tubutree.com/api' }).policy, 'script-src')!;
    const dev = directive(buildCsp({ apiBaseUrl: 'https://api.tubutree.com/api', dev: true }).policy, 'script-src')!;
    expect(prod.split(' ')).not.toContain("'unsafe-eval'");
    expect(prod.split(' ')).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]));
    expect(dev.split(' ')).toContain("'unsafe-eval'");
  });

  it('next.config gắn header Reporting-Endpoints khớp report-uri của chính sách đang dùng', async () => {
    const headers = (await nextConfig.headers!()).flatMap((r) => r.headers);
    const policy = headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')!.value;
    const endpoints = headers.find((h) => h.key === 'Reporting-Endpoints')?.value;
    const reportUri = directive(policy, 'report-uri')!.slice('report-uri '.length);
    expect(reportUri).toMatch(/\/csp-report$/);
    expect(endpoints).toBe(`${CSP_REPORT_GROUP}="${reportUri}"`);
    expect(directive(policy, 'report-to')).toBe(`report-to ${CSP_REPORT_GROUP}`);
  });
});

describe('next.config htmlLimitedBots', () => {
  const re = nextConfig.htmlLimitedBots as RegExp;

  it('Googlebot desktop và điện thoại nhận metadata trong <head> (không theo luồng)', () => {
    expect(re.test('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(re.test('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.6778.139 Safari/537.36')).toBe(true);
    expect(re.test('Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.139 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
  });

  it('Chrome desktop thường không bị coi là bot', () => {
    expect(re.test('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toBe(false);
  });
});

describe('next.config cacheHandler', () => {
  it('dùng isr-cache-handler.mjs (đường dẫn tuyệt đối, file có thật)', async () => {
    const { existsSync } = await import('node:fs');
    const { isAbsolute } = await import('node:path');
    expect(nextConfig.cacheHandler).toMatch(/isr-cache-handler\.mjs$/);
    expect(isAbsolute(nextConfig.cacheHandler!)).toBe(true);
    expect(existsSync(nextConfig.cacheHandler!)).toBe(true);
  });
});
