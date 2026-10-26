// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
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
    expect(rewriteOf(withCookie('tubu_web_session=1', '/san-pham'))).toBeNull();
  });
});
