import { describe, expect, it } from 'vitest';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { modifyRouteRegex } from 'next/dist/lib/redirect-status';
import nextConfig from '../../next.config.mjs';
import { NOT_PREVIEW_SOURCE, PREVIEW_PATH, PREVIEW_SOURCES, previewFrameAncestors } from './preview-frame-ancestors.mjs';

describe('previewFrameAncestors', () => {
  it("rỗng, thiếu biến hay toàn giá trị sai thì 'none'", () => {
    for (const raw of [undefined, null, '', '   ', ',', '*', "'self'", 'mss.example.com', 'ftp://mss.example.com']) {
      expect(previewFrameAncestors(raw), String(raw)).toBe("'none'");
    }
  });

  it('nhận origin https, cách nhau dấu phẩy hay khoảng trắng, bỏ trùng, chuẩn hoá chữ thường và cổng mặc định', () => {
    expect(previewFrameAncestors('https://mss.example.com')).toBe('https://mss.example.com');
    expect(previewFrameAncestors('https://MSS.Example.com/, https://admin.mss.vn:8443\nhttps://mss.example.com:443')).toBe(
      'https://mss.example.com https://admin.mss.vn:8443',
    );
  });

  it('bỏ origin có đường dẫn, query, mảnh, tài khoản, ký tự đại diện, cổng sai hay giao thức http (production)', () => {
    const bad = [
      'https://mss.example.com/preview',
      'https://mss.example.com?x=1',
      'https://mss.example.com#a',
      'https://user:pw@mss.example.com',
      'https://*.example.com',
      'https://mss.example.com:0',
      'https://mss.example.com:99999',
      'https://-bad.example.com',
      'https://mss.example.com;script-src',
      'http://mss.example.com',
      'http://localhost:3000',
      'javascript:alert(1)',
      "https://mss.example.com'",
    ];
    for (const raw of bad) expect(previewFrameAncestors(raw), raw).toBe("'none'");
    expect(previewFrameAncestors(`${bad.join(',')},https://ok.example.com`)).toBe('https://ok.example.com');
  });

  it('ngoài production nhận thêm http://localhost:<cổng> (MSS chạy máy dev), không nhận http host khác', () => {
    expect(previewFrameAncestors('http://localhost:5173 https://mss.example.com', { production: false })).toBe('http://localhost:5173 https://mss.example.com');
    expect(previewFrameAncestors('http://localhost', { production: false })).toBe("'none'");
    expect(previewFrameAncestors('http://127.0.0.1:5173', { production: false })).toBe("'none'");
    expect(previewFrameAncestors('http://mss.example.com', { production: false })).toBe("'none'");
  });
});

/** Khớp đường dẫn đúng cách Next khớp `source` của headers() (server/lib/router-utils/filesystem.js, buildCustomRoute). */
const matcher = (source: string) =>
  getPathMatch(source, { strict: true, removeUnnamedParams: true, regexModifier: (r) => modifyRouteRegex(r), sensitive: false });

describe('next.config headers(): trang xem trước tách khỏi X-Frame-Options DENY', () => {
  const PREVIEW = ['/san-pham/_preview', '/san-pham/_preview/', '/san-pham/_preview/nuoc-rua-chen', '/san-pham/_preview/a/b', '/SAN-PHAM/_Preview'];
  const OTHERS = [
    '/',
    '/san-pham',
    '/san-pham/',
    '/san-pham/nuoc-rua-chen',
    '/san-pham/_previewx',
    '/san-pham/x_preview',
    '/san-pham/%5Fpreview',
    '/x/san-pham/_preview',
    '/admin',
    '/admin/products',
    '/gio-hang',
    '/thanh-toan/chuyen-khoan/TT1',
    '/_next/static/chunks/main.js',
    '/api/img',
    '/robots.txt',
  ];

  it('hai luật bù trừ nhau: mỗi đường dẫn khớp đúng một trong hai', () => {
    const notPreview = matcher(NOT_PREVIEW_SOURCE);
    const preview = PREVIEW_SOURCES.map(matcher);
    for (const p of PREVIEW) {
      expect(notPreview(p), p).toBe(false);
      expect(preview.some((m) => m(p) !== false), p).toBe(true);
    }
    for (const p of OTHERS) {
      expect(notPreview(p), p).not.toBe(false);
      expect(preview.every((m) => m(p) === false), p).toBe(true);
    }
  });

  it('mọi trang khác vẫn nhận đủ header cũ (X-Frame-Options DENY, nosniff, Referrer, Permissions, CSP Report-Only) và không có CSP chặn thật', async () => {
    const rules = await nextConfig.headers!();
    for (const p of OTHERS) {
      const hit = rules.filter((r) => matcher(r.source)(p) !== false);
      expect(hit, p).toHaveLength(1);
      const byKey = Object.fromEntries(hit[0]!.headers.map((h) => [h.key, h.value]));
      expect(byKey['X-Frame-Options'], p).toBe('DENY');
      expect(byKey['X-Content-Type-Options'], p).toBe('nosniff');
      expect(byKey['Referrer-Policy'], p).toBe('strict-origin-when-cross-origin');
      expect(byKey['Permissions-Policy'], p).toBe('camera=(), microphone=(), geolocation=(self)');
      expect(byKey['Content-Security-Policy-Report-Only'], p).toContain("frame-ancestors 'none'");
      expect(byKey['Content-Security-Policy'], p).toBeUndefined();
      expect(byKey['X-Robots-Tag'], p).toBeUndefined();
    }
  });

  it('trang xem trước: không X-Frame-Options, có CSP frame-ancestors chặn thật, no-store, noindex; vẫn giữ các header bảo mật khác', async () => {
    const rules = await nextConfig.headers!();
    for (const p of PREVIEW) {
      const hit = rules.filter((r) => matcher(r.source)(p) !== false);
      expect(hit.length, p).toBeGreaterThan(0);
      const headers = hit.flatMap((r) => r.headers);
      const byKey = Object.fromEntries(headers.map((h) => [h.key, h.value]));
      expect(headers.some((h) => h.key === 'X-Frame-Options'), p).toBe(false);
      // Môi trường test không đặt MSS_PREVIEW_FRAME_ANCESTORS: không nơi nào được nhúng.
      expect(byKey['Content-Security-Policy'], p).toBe("frame-ancestors 'none'");
      expect(byKey['Cache-Control'], p).toBe('no-store');
      expect(byKey['X-Robots-Tag'], p).toBe('noindex, nofollow');
      expect(byKey['X-Content-Type-Options'], p).toBe('nosniff');
      expect(byKey['Content-Security-Policy-Report-Only'], p).toContain("frame-ancestors 'none'");
    }
  });

  it('PREVIEW_PATH là đường trang Next thật (thư mục %5Fpreview) mà MSS nhúng theo hợp đồng', () => {
    expect(PREVIEW_PATH).toBe('/san-pham/_preview');
  });
});
