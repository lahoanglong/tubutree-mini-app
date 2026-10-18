import { describe, expect, it } from 'vitest';
import {
  checkParity,
  parseMiniAppRoutes,
  webPathToFileCandidates,
} from '../../../scripts/check-platform-parity.mjs';

const APP_TSX = `
  <Route path="/" element={<A />} />
  <Route path="/product/:slug" element={<B />} />
  <Route path="/subscriptions" element={<Navigate to="/orders" replace />} />
  <Route path="*" element={<NotFound />} />
`;

const base = () => ({
  miniappRoutes: ['/', '/browse'],
  map: {
    routes: [
      {
        lane: 'shop',
        items: [
          { miniapp: '/', web: '/', private: false },
          { miniapp: '/browse', web: '/san-pham', private: false, pending: true },
        ],
      },
    ],
    features: [] as unknown[],
  },
  webFileExists: (p: string) => p === 'apps/web/src/app/page.tsx',
  fileHasSymbol: () => true,
});

describe('parseMiniAppRoutes', () => {
  it('đọc mọi path của <Route>, bỏ dấu *', () => {
    expect(parseMiniAppRoutes(APP_TSX)).toEqual(['/', '/product/:slug', '/subscriptions']);
  });
});

describe('webPathToFileCandidates', () => {
  it(':x thành [x], bỏ query, gốc là app/page', () => {
    expect(webPathToFileCandidates('/')).toContain('apps/web/src/app/page.tsx');
    expect(webPathToFileCandidates('/tai-khoan/don-hang/:code?tab=a')).toContain(
      'apps/web/src/app/tai-khoan/don-hang/[code]/page.tsx',
    );
    expect(webPathToFileCandidates('/product/:slug')).toContain('apps/web/src/app/product/[slug]/route.ts');
  });
});

describe('checkParity', () => {
  it('xanh khi khớp, pending chỉ cảnh báo', () => {
    const r = checkParity(base());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it('--strict coi pending là lỗi', () => {
    expect(checkParity({ ...base(), strict: true }).errors).toHaveLength(1);
  });

  it('đỏ khi route Mini App không có dòng', () => {
    const r = checkParity({ ...base(), miniappRoutes: ['/', '/browse', '/cart'] });
    expect(r.errors.join('\n')).toMatch(/\/cart.*không có dòng/);
  });

  it('đỏ khi có dòng thừa', () => {
    const r = checkParity({ ...base(), miniappRoutes: ['/'] });
    expect(r.errors.join('\n')).toMatch(/\/browse.*thừa/);
  });

  it('đỏ khi một route có hai dòng', () => {
    const b = base();
    b.map.routes[0]!.items.push({ miniapp: '/', web: '/', private: false });
    expect(checkParity(b).errors.join('\n')).toMatch(/\/.*trùng/);
  });

  it('đỏ khi skip thiếu lý do', () => {
    const b = base();
    b.map.routes.push({ lane: 'skip', items: [{ miniapp: '/x', skip: '' } as never] });
    const r = checkParity({ ...b, miniappRoutes: ['/', '/browse', '/x'] });
    expect(r.errors.join('\n')).toMatch(/\/x.*lý do/);
  });

  it('skip có lý do thì hợp lệ', () => {
    const b = base();
    b.map.routes.push({ lane: 'skip', items: [{ miniapp: '/x', skip: 'Q2' } as never] });
    expect(checkParity({ ...b, miniappRoutes: ['/', '/browse', '/x'] }).errors).toEqual([]);
  });

  it('đỏ khi dòng không pending mà web không có file', () => {
    const b = base();
    delete (b.map.routes[0]!.items[1] as { pending?: boolean }).pending;
    expect(checkParity(b).errors.join('\n')).toMatch(/\/browse.*\/san-pham.*không có/);
  });

  it('đỏ khi feature không pending mà symbol web không có', () => {
    const b = base();
    b.map.features.push({
      id: 'gate',
      lane: 'account',
      miniapp: ['apps/miniapp/src/components/app.tsx', 'Gate'],
      web: ['apps/web/src/components/app-gates.tsx', 'Gate'],
    });
    const r = checkParity({ ...b, fileHasSymbol: (f: string) => f.startsWith('apps/miniapp') });
    expect(r.errors.join('\n')).toMatch(/gate.*web/);
  });

  it('feature pending không kiểm symbol web', () => {
    const b = base();
    b.map.features.push({
      id: 'gate',
      lane: 'account',
      miniapp: ['apps/miniapp/src/components/app.tsx', 'Gate'],
      web: ['apps/web/src/components/app-gates.tsx', 'Gate'],
      pending: true,
    });
    const r = checkParity({ ...b, fileHasSymbol: (f: string) => f.startsWith('apps/miniapp') });
    expect(r.errors).toEqual([]);
  });

  it('đỏ khi symbol Mini App của feature không còn', () => {
    const b = base();
    b.map.features.push({
      id: 'gate',
      lane: 'account',
      miniapp: ['apps/miniapp/src/components/app.tsx', 'Gate'],
      web: ['apps/web/src/components/app-gates.tsx', 'Gate'],
      pending: true,
    });
    const r = checkParity({ ...b, fileHasSymbol: () => false });
    expect(r.errors.join('\n')).toMatch(/gate.*Mini App/);
  });
});
