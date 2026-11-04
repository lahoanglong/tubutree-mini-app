// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { LEGAL_SLUGS } from '@/lib/legal';
import { middleware } from './middleware';

const visit = (host: string, path = '/') => middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
const rewriteOf = (res: Response) => res.headers.get('x-middleware-rewrite');

describe('middleware: trang chủ subdomain gian hàng', () => {
  it('<tên>.tubutree.com/ được rewrite sang /s/<tên>', () => {
    expect(rewriteOf(visit('ctv-an.tubutree.com'))).toBe('https://ctv-an.tubutree.com/s/ctv-an');
  });

  it('host ngoài tên miền gốc (bản xem trước *.vercel.app, tên miền lạ) không bị coi là gian hàng', () => {
    for (const host of ['tubutree-web-git-main-x.vercel.app', 'ctv-an.example.com', 'ctv-an.nottubutree.com']) {
      expect(rewriteOf(visit(host)), host).toBeNull();
    }
  });

  it('host hệ thống và host gốc đi thẳng', () => {
    for (const host of ['app.tubutree.com', 'www.tubutree.com', 'tubutree.com', 'localhost:3000']) {
      expect(rewriteOf(visit(host)), host).toBeNull();
    }
  });

  it('đường dẫn khác trang chủ của subdomain gian hàng không bị rewrite', () => {
    expect(rewriteOf(visit('ctv-an.tubutree.com', '/san-pham/abc'))).toBeNull();
  });
});

describe('middleware: Trang chủ cho khách đã có cookie phiên', () => {
  const withCookie = (cookie: string, path = '/') =>
    middleware(new NextRequest(`https://tubutree.com${path}`, { headers: { host: 'tubutree.com', cookie } }));

  it('có cookie phiên: rewrite "/" sang bản dựng sẵn theo gợi ý, URL trình duyệt không đổi', () => {
    expect(rewriteOf(withCookie('tubu_web_session=1; tubu_home_hint=returning-2'))).toBe('https://tubutree.com/khoi-phuc/returning-2');
    expect(rewriteOf(withCookie('tubu_web_session=1; tubu_home_hint=new'))).toBe('https://tubutree.com/khoi-phuc/new');
  });

  it('thiếu hoặc sai gợi ý: bản "unknown" (không tin cookie)', () => {
    expect(rewriteOf(withCookie('tubu_web_session=1'))).toBe('https://tubutree.com/khoi-phuc/unknown');
    expect(rewriteOf(withCookie('tubu_web_session=1; tubu_home_hint=../admin'))).toBe('https://tubutree.com/khoi-phuc/unknown');
  });

  it('không có cookie phiên (hoặc giá trị khác 1): vẫn là bản khách mới, không rewrite', () => {
    expect(rewriteOf(withCookie('tubu_home_hint=returning-1'))).toBeNull();
    expect(rewriteOf(withCookie('tubu_web_session=0'))).toBeNull();
  });

  it('chỉ rewrite "/": trang khác đi thẳng', () => {
    expect(rewriteOf(withCookie('tubu_web_session=1', '/gio-hang'))).toBeNull();
  });
});

describe('middleware: slug dài vô lý không vào cache trang theo [slug]', () => {
  const notFoundOf = (res: Response) => res.status === 404 && res.headers.get('cache-control') === 'no-store' && !!rewriteOf(res);
  // Slug dài nhất API sinh ra: tên 200 ký tự (tối đa merchant DTO) -> slugify + '-' + Date.now().toString(36).
  const longestSlug = `${'a'.repeat(199)}-${Date.now().toString(36)}`;

  it('slug thật dài nhất API sinh ra (~209 ký tự) vẫn đi thẳng ở san-pham, s, brand', () => {
    expect(longestSlug.length).toBeGreaterThan(200);
    for (const base of ['san-pham', 's', 'brand']) {
      expect(visit('tubutree.com', `/${base}/${longestSlug}`).status, base).toBe(200);
    }
  });

  it('slug quá trần của từng route hoặc sai ký tự trả 404 không cache, có khung site', () => {
    for (const base of ['san-pham', 's', 'brand']) {
      expect(notFoundOf(visit('tubutree.com', `/${base}/${'a'.repeat(257)}`)), base).toBe(true);
      expect(notFoundOf(visit('tubutree.com', `/${base}/ten%20la`)), base).toBe(true);
      expect(visit('tubutree.com', `/${base}/${'a'.repeat(256)}`).status, base).toBe(200);
    }
    expect(notFoundOf(visit('tubutree.com', `/chien-dich/${'a'.repeat(81)}`))).toBe(true);
    expect(visit('tubutree.com', `/chien-dich/${'a'.repeat(80)}`).status).toBe(200);
  });

  it('chinh-sach chỉ nhận đúng các slug pháp lý', () => {
    expect(notFoundOf(visit('tubutree.com', '/chinh-sach/khong-co-that'))).toBe(true);
    expect(visit('tubutree.com', `/chinh-sach/${LEGAL_SLUGS[0]}`).status).toBe(200);
  });

  it('route khác đi thẳng', () => {
    expect(visit('tubutree.com', `/ctv/${'a'.repeat(300)}`).status).toBe(200);
    expect(visit('tubutree.com', `/mua-chung/${'a'.repeat(300)}`).status).toBe(200);
  });
});

describe('middleware: hub /san-pham dùng bản ISR', () => {
  const at = (path: string, host = 'tubutree.com') => middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));

  it('/san-pham không tham số lọc được rewrite sang bản tĩnh, URL trình duyệt không đổi', () => {
    expect(rewriteOf(at('/san-pham'))).toBe('https://tubutree.com/hub-san-pham');
  });

  it('tham số theo dõi và focus vẫn dùng bản tĩnh', () => {
    for (const qs of ['utm_source=zalo&utm_campaign=x', 'ref=AN1', 'fbclid=abc', 'focus=search']) {
      expect(rewriteOf(at(`/san-pham?${qs}`)), qs).toBe('https://tubutree.com/hub-san-pham');
    }
  });

  it('có từ khoá, bộ lọc hoặc số trang thì không rewrite (trang /san-pham động)', () => {
    for (const qs of ['q=goi', 'q=', 'brand=Tubu', 'category=c1', 'page=2', 'all=1', 'sort=newest', 'utm_source=zalo&brand=Tubu']) {
      expect(rewriteOf(at(`/san-pham?${qs}`)), qs).toBeNull();
    }
  });

  it('vào thẳng đường dẫn nội bộ: 308 về /san-pham', () => {
    const res = at('/hub-san-pham');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://tubutree.com/san-pham');
  });

  it('host gian hàng (subdomain) không bị rewrite', () => {
    expect(rewriteOf(at('/san-pham', 'ctv-an.tubutree.com'))).toBeNull();
  });
});
