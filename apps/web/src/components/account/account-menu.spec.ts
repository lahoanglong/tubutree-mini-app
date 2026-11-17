import { describe, expect, it } from 'vitest';
import { buildProfileMenu } from '@tubutree/app-core/profile-menu';
import { isWebRouteReady } from '@/lib/route-map';
import { buildAccountMenu, IN_ACCOUNT_SHELL, type AccountMenuContext, type AccountMenuRow } from './account-menu';

// Dòng, thứ tự, nhãn và luật theo vai trò/cờ có spec ở packages/app-core/src/profile-menu.spec.ts; ở đây chỉ phần riêng web: đích web, route pending, cột trái.

const ctx = (over: Partial<AccountMenuContext> = {}): AccountMenuContext => ({
  role: 'CUSTOMER',
  chatEnabled: true,
  aiEnabled: true,
  wasteEnabled: true,
  recycleOpenRequests: false,
  badgesEnabled: false,
  hasReferralCode: true,
  couponCount: 2,
  dealer: null,
  ownedBrandName: null,
  isReady: () => true,
  ...over,
});
const children = (rows: AccountMenuRow[], key: string) => {
  const r = rows.find((x) => x.key === key);
  return r?.kind === 'accordion' ? r.children : [];
};
const allTargets = (rows: AccountMenuRow[]) => rows.flatMap((r) => (r.kind === 'link' ? [r.to] : r.children.map((c) => c.to)));

describe('menu trang Cá nhân web', () => {
  it('cùng dòng, cùng thứ tự, cùng chữ với Mini App (một nguồn buildProfileMenu)', () => {
    const c = ctx({ role: 'ADMIN', ownedBrandName: 'Nhãn A', deskPointNames: ['Kho'] });
    const web = buildAccountMenu(c);
    const shared = buildProfileMenu(c);
    expect(web.map((r) => [r.key, r.kind, r.label, r.hint])).toEqual(shared.map((r) => [r.key, r.kind, r.label, r.hint]));
    expect(children(web, 'partner').map((i) => i.label)).toEqual(children(shared as never, 'partner').map((i) => i.label));
  });

  it('đích là route web', () => {
    const rows = buildAccountMenu(ctx());
    expect(rows.flatMap((r) => (r.kind === 'link' ? [[r.key, r.to]] : []))).toEqual([
      ['offers', '/uu-dai'],
      ['addresses', '/tai-khoan/dia-chi'],
      ['wishlist', '/tai-khoan/yeu-thich'],
      ['recycle', '/doi-rac'],
      ['settings', '/tai-khoan/cai-dat'],
    ]);
    expect(children(rows, 'support').map((i) => i.to)).toEqual(['/ho-tro/chat', '/tu-van', '/gioi-thieu', '/cau-chuyen']);
  });

  it('mục trỏ route còn pending thì ẩn; dòng mở tại chỗ hết mục con thì bỏ cả dòng (trừ Mời bạn)', () => {
    const rows = buildAccountMenu(ctx({ role: 'STAFF', isReady: (p) => !p.startsWith('/nhan-vien') && p !== '/tu-van' }));
    expect(allTargets(rows)).not.toContain('/nhan-vien');
    expect(children(rows, 'support').map((i) => i.to)).toEqual(['/ho-tro/chat', '/gioi-thieu', '/cau-chuyen']);
    const none = buildAccountMenu(ctx({ role: 'STAFF', isReady: () => false }));
    expect(none.map((r) => r.key)).toEqual(['invite']);
  });

  it('dòng đã có ở cột trái AccountShell: Thông báo, Sổ địa chỉ, Yêu thích, Cài đặt', () => {
    expect([...IN_ACCOUNT_SHELL].sort()).toEqual(['addresses', 'notifications', 'settings', 'wishlist']);
  });

  it('mỗi dòng và mục con đều có biểu tượng', () => {
    const rows = buildAccountMenu(ctx({ role: 'ADMIN', ownedBrandName: 'Nhãn A', deskPointNames: ['Kho'], ctvAccess: { isAffiliate: true } }));
    for (const r of rows) {
      expect(r.icon, r.key).toBeTruthy();
      if (r.kind === 'accordion') for (const c of r.children) expect(c.icon, c.key).toBeTruthy();
    }
  });
});

describe('với route map thật', () => {
  const real = { isReady: isWebRouteReady };

  it('đại lý, chủ nhãn, nhân viên, quầy và Học viện có lối vào trong "Dành cho đối tác"', () => {
    const rows = buildAccountMenu(ctx({ ...real, role: 'ADMIN', ownedBrandName: 'Nhãn A', ctvAccess: { isAffiliate: true }, deskPointNames: ['Kho'] }));
    expect(children(rows, 'partner').map((i) => i.to)).toEqual(['/ctv', '/hoc-vien', '/dai-ly', '/chu-thuong-hieu', '/nhan-vien', '/nhan-vien/bang-luong', '/doi-rac/quay', '/admin?tab=staffRoster']);
  });

  it('khách thường: bảy dòng, không có dòng đối tác, không thấy màn nội bộ', () => {
    const rows = buildAccountMenu(ctx(real));
    expect(rows.map((r) => r.key)).toEqual(['offers', 'invite', 'addresses', 'wishlist', 'recycle', 'support', 'settings']);
    for (const t of ['/dai-ly', '/chu-thuong-hieu', '/nhan-vien', '/admin?tab=staffRoster', '/tai-khoan/thong-bao', '/hoan-tien']) expect(allTargets(rows)).not.toContain(t);
  });
});
