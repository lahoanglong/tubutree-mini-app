import { describe, expect, it } from 'vitest';
import { tenantSubdomain } from './tenant-subdomain';

describe('tenantSubdomain', () => {
  it.each([
    ['ctv-an.tubutree.com', 'ctv-an'],
    ['CTV-An.TubuTree.com', 'ctv-an'],
    ['ctv-an.tubutree.com:3000', 'ctv-an'],
    ['ctv-an.localhost', 'ctv-an'],
    ['ctv-an.localhost:3000', 'ctv-an'],
    ['ctv-an.staging.tubutree.com', 'ctv-an'],
  ])('%s → %s', (host, out) => {
    expect(tenantSubdomain(host)).toBe(out);
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
