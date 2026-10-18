import { describe, expect, it } from 'vitest';
import { tenantSubdomain } from './tenant-subdomain';

describe('tenantSubdomain', () => {
  it.each([
    ['ctv-an.tubutree.com', 'ctv-an'],
    ['CTV-An.TubuTree.com', 'ctv-an'],
    ['ctv-an.tubutree.com:3000', 'ctv-an'],
    ['ctv-an.localhost', 'ctv-an'],
    ['ctv-an.localhost:3000', 'ctv-an'],
  ])('%s → %s', (host, out) => {
    expect(tenantSubdomain(host)).toBe(out);
  });

  it.each([
    ['ctv-an.tubutree.com', 'tubutree.com', 'ctv-an'],
    ['ctv-an.staging.tubutree.com', 'staging.tubutree.com', 'ctv-an'],
    ['ctv-an.localhost', 'staging.tubutree.com', 'ctv-an'],
  ])('%s với gốc %s → %s', (host, root, out) => {
    expect(tenantSubdomain(host, root)).toBe(out);
  });

  it.each([
    ['du-an-xanh.vercel.app', 'tubutree.com'],
    ['tubutree-web-git-main-x.vercel.app', 'tubutree.com'],
    ['ctv-an.example.com', 'tubutree.com'],
    ['ctv-an.nottubutree.com', 'tubutree.com'],
    ['ctv-an.tubutree.com.evil.test', 'tubutree.com'],
    ['a.b.tubutree.com', 'tubutree.com'],
    ['ctv-an.staging.tubutree.com', 'tubutree.com'],
    ['ctv-an.tubutree.com', 'staging.tubutree.com'],
    ['xanh.10.0.0.5.nip.io', 'tubutree.com'],
  ])('%s không thuộc gốc %s → không phải gian hàng', (host, root) => {
    expect(tenantSubdomain(host, root)).toBeNull();
  });

  it.each([
    ['tubutree.com'],
    ['localhost'],
    ['localhost:3000'],
    ['a.b.localhost'],
    ['app.tubutree.com'],
    ['www.tubutree.com'],
    ['admin.tubutree.com'],
    ['api.tubutree.com'],
    ['mail.tubutree.com'],
    ['www.localhost'],
    [''],
  ])('%s → null (host thường hoặc subdomain hệ thống)', (host) => {
    expect(tenantSubdomain(host)).toBeNull();
  });
});
