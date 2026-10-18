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
