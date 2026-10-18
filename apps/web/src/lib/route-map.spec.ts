import { describe, expect, it, vi } from 'vitest';
import routeMap from '@tubutree/app-core/route-map.json';
import {
  isWebRouteReady,
  miniappPathFor,
  miniappRedirects,
  privatePrefixes,
  publicAllowPaths,
  publicStaticRoutes,
} from './route-map';
import { buildMiniappRedirects } from './miniapp-redirects.mjs';

const groups = (items: unknown[]) => [{ lane: 't', items }] as never;

describe('isWebRouteReady', () => {
  it('route đã xong (không pending) là sẵn sàng', () => {
    expect(isWebRouteReady('/gio-hang')).toBe(true);
    expect(isWebRouteReady('/')).toBe(true);
  });

  it('route còn pending thì chưa sẵn sàng (bản đồ giả, không phụ thuộc lane nào đã xong chưa)', async () => {
    vi.resetModules();
    vi.doMock('@tubutree/app-core/route-map.json', () => ({
      default: { groups: [{ lane: 't', items: [{ miniapp: '/x', web: '/chua-xong', pending: true }, { miniapp: '/y', web: '/da-xong' }] }] },
    }));
    const fake = await import('./route-map');
    expect(fake.isWebRouteReady('/chua-xong')).toBe(false);
    expect(fake.isWebRouteReady('/da-xong')).toBe(true);
    vi.doUnmock('@tubutree/app-core/route-map.json');
    vi.resetModules();
  });

  it('khớp cả dòng có tham số và bỏ qua query của đường vào', () => {
    expect(isWebRouteReady('/san-pham/dau-goi')).toBe(true);
    expect(isWebRouteReady('/tai-khoan/don-hang/ABC123?x=1')).toBe(true);
  });

  it('đường dẫn không có trong bản đồ thì không coi là sẵn sàng', () => {
    expect(isWebRouteReady('/khong-co-trang-nay')).toBe(false);
  });
});

describe('miniappPathFor', () => {
  it('tra ngược đường tĩnh', () => {
    expect(miniappPathFor('/gio-hang')).toBe('/cart');
    expect(miniappPathFor('/tai-khoan')).toBe('/profile');
  });

  it('thay tham số bằng giá trị thật', () => {
    expect(miniappPathFor('/san-pham/dau-goi-bo-ket')).toBe('/product/dau-goi-bo-ket');
    expect(miniappPathFor('/tai-khoan/don-hang/TT123')).toBe('/order/TT123');
    expect(miniappPathFor('/doi-rac/yeu-cau/r1/sua')).toBe('/recycle/r/r1/edit');
  });

  it('dòng có query đích chỉ khớp khi query có mặt, ngược lại về dòng không query', () => {
    expect(miniappPathFor('/tai-khoan/don-hang?tab=subscriptions')).toBe('/subscriptions');
    expect(miniappPathFor('/tai-khoan/don-hang')).toBe('/orders');
    expect(miniappPathFor('/tai-khoan/don-hang?tab=other')).toBe('/orders');
    expect(miniappPathFor('/admin?tab=community')).toBe('/admin/community');
    expect(miniappPathFor('/admin')).toBe('/admin');
  });

  it('đường tĩnh thắng đường động cùng tầng', () => {
    expect(miniappPathFor('/doi-rac/yeu-cau')).toBe('/recycle/requests');
  });

  it('không có trong bản đồ: null', () => {
    expect(miniappPathFor('/khong-co')).toBeNull();
  });

  it('dòng skip (không có web) không bao giờ là đích', () => {
    expect(miniappPathFor('/points/scan')).toBeNull();
  });
});

describe('privatePrefixes', () => {
  it('cắt từ tham số đầu, bỏ query, khử trùng', () => {
    const p = privatePrefixes();
    expect(p).toContain('/doi-rac');
    expect(p).toContain('/tai-khoan');
    expect(p).toContain('/admin');
    expect(p.filter((x) => x === '/admin')).toHaveLength(1);
    expect(p.every((x) => !x.includes(':') && !x.includes('?'))).toBe(true);
  });

  it('không chứa tiền tố nằm dưới tiền tố khác', () => {
    const p = privatePrefixes();
    for (const a of p) for (const b of p) if (a !== b) expect(a.startsWith(`${b}/`)).toBe(false);
  });

  it('không chứa route công khai thuần', () => {
    expect(privatePrefixes()).not.toContain('/san-pham');
    expect(privatePrefixes()).not.toContain('/');
  });
});

describe('publicStaticRoutes', () => {
  it('chỉ route công khai, không tham số, không pending, không query', () => {
    const r = publicStaticRoutes();
    expect(r).toContain('/');
    const pendingPublic = (routeMap.routes as { items: { web?: string; private?: boolean; pending?: boolean }[] }[])
      .flatMap((g) => g.items)
      .filter((i) => i.pending && !i.private && i.web && !i.web.includes(':') && !i.web.includes('?'))
      .map((i) => i.web!);
    expect(pendingPublic.length).toBeGreaterThan(0);
    for (const w of pendingPublic) expect(r).not.toContain(w);
    expect(r).toContain('/gioi-thieu');
    expect(r.every((x) => !x.includes(':') && !x.includes('?'))).toBe(true);
  });
});

describe('publicAllowPaths', () => {
  it('route công khai tĩnh nằm dưới tiền tố riêng tư, kể cả pending', () => {
    expect(publicAllowPaths(['/doi-rac', '/tai-khoan'])).toEqual(['/doi-rac/quy-dinh']);
  });

  it('route công khai trùng đúng tiền tố cũng được cho phép', () => {
    expect(publicAllowPaths(['/cong-dong'])).toContain('/cong-dong');
  });

  it('không ghi literal tham số', () => {
    for (const p of publicAllowPaths(privatePrefixes())) expect(p).not.toContain(':');
  });
});

describe('miniappRedirects', () => {
  const list = miniappRedirects();

  it('307 (permanent false) cho mọi dòng', () => {
    expect(list.length).toBeGreaterThan(20);
    expect(list.every((r) => r.permanent === false)).toBe(true);
  });

  it('bỏ dòng hai bên cùng đường dẫn, /product/:slug và dòng skip', () => {
    const sources = list.map((r) => r.source);
    for (const s of ['/', '/s/:slug', '/brand/:slug', '/admin', '/product/:slug', '/points/scan']) {
      expect(sources).not.toContain(s);
    }
  });

  it('chuyển đúng đích, giữ query đích', () => {
    expect(list).toContainEqual({ source: '/cart', destination: '/gio-hang', permanent: false });
    expect(list).toContainEqual({
      source: '/subscriptions',
      destination: '/tai-khoan/don-hang?tab=subscriptions',
      permanent: false,
    });
    expect(list).toContainEqual({ source: '/order/:code', destination: '/tai-khoan/don-hang/:code', permanent: false });
  });

  it('đường tĩnh đứng trước đường động', () => {
    const sources = list.map((r) => r.source);
    expect(sources.indexOf('/feed/events')).toBeLessThan(sources.indexOf('/feed/:id'));
    expect(sources.indexOf('/feed/leaderboard')).toBeLessThan(sources.indexOf('/feed/:id'));
    expect(sources.indexOf('/recycle/requests')).toBeLessThan(sources.indexOf('/recycle/r/:id'));
  });

  it('mọi tham số ở đích đều có ở nguồn (Next từ chối nếu không)', () => {
    for (const r of list) {
      const src = new Set(r.source.match(/:\w+/g) ?? []);
      for (const p of r.destination.match(/:\w+/g) ?? []) expect(src.has(p)).toBe(true);
    }
  });

  it('không có nguồn trùng', () => {
    const sources = list.map((r) => r.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('hàm sinh danh sách là hàm thuần trên dữ liệu vào', () => {
    const out = buildMiniappRedirects(
      groups([
        { miniapp: '/a/:x', web: '/b/:x' },
        { miniapp: '/a/fixed', web: '/c' },
        { miniapp: '/same', web: '/same' },
        { miniapp: '/skipme', skip: 'why' },
      ]),
    );
    expect(out).toEqual([
      { source: '/a/fixed', destination: '/c', permanent: false },
      { source: '/a/:x', destination: '/b/:x', permanent: false },
    ]);
  });

  it('khớp với route map thật', () => {
    expect(buildMiniappRedirects(routeMap.routes as never)).toEqual(list);
  });
});
