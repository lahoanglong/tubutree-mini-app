import { evaluateDb } from './db-checks';
import { evaluateDemoData, type DemoDataSnapshot } from './demo-data-checks';
import { GOOD_DB, GOOD_ENV, byId, dbWith, envWith } from './go-live.fixtures';
import type { Env } from './types';

const CLEAN: DemoDataSnapshot = { products: { found: 44, active: 0 }, activeVariations: 0, liveCoupons: [] };
const FRESH: DemoDataSnapshot = {
  products: { found: 44, active: 44 },
  activeVariations: 48,
  liveCoupons: [
    { code: 'WELCOME30', endAt: '2026-12-31T17:00:00.000Z', fromMigration: true },
    { code: 'FREESHIP', endAt: '2026-12-31T17:00:00.000Z', fromMigration: true },
    { code: 'XANH10', endAt: '2026-12-31T17:00:00.000Z', fromMigration: true },
  ],
};

const run = (s: DemoDataSnapshot, env: Env = GOOD_ENV) => evaluateDemoData(s, env);

describe('evaluateDemoData', () => {
  it('đã dọn: hai dòng PASS, không cách sửa', () => {
    const r = run(CLEAN);
    expect(r.map((x) => [x.id, x.status])).toEqual([
      ['db.demo_products', 'PASS'],
      ['db.demo_coupons', 'PASS'],
    ]);
    expect(byId(r, 'db.demo_products').detail).toContain('44');
    for (const x of r) expect(x.hint).toBe('');
  });

  it('DB không có dữ liệu demo nào: PASS', () => {
    const r = run({ products: { found: 0, active: 0 }, activeVariations: 0, liveCoupons: [] });
    expect(byId(r, 'db.demo_products').status).toBe('PASS');
    expect(byId(r, 'db.demo_products').detail).toContain('không có');
  });

  it('DB vừa migrate: FAIL cả sản phẩm lẫn mã, cách sửa chỉ lệnh dọn', () => {
    const r = run(FRESH);
    const p = byId(r, 'db.demo_products');
    expect(p.status).toBe('FAIL');
    expect(p.detail).toContain('44 sản phẩm');
    expect(p.detail).toContain('48 biến thể');
    expect(p.hint).toContain('prisma:cleanup-demo');
    const c = byId(r, 'db.demo_coupons');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('WELCOME30');
    expect(c.detail).toContain('XANH10');
    expect(c.hint).toContain('--coupons=expire');
    expect(c.hint).toContain('GO_LIVE_ACCEPT_DEMO_COUPONS');
  });

  it('chỉ còn biến thể demo đang bán (sản phẩm đã tắt) vẫn FAIL: giờ vàng chỉ lọc theo biến thể', () => {
    expect(byId(run({ ...CLEAN, activeVariations: 2 }), 'db.demo_products').status).toBe('FAIL');
  });

  it('chủ dự án duyệt giữ WELCOME30: mã đó thành WARN, mã khác còn hạn vẫn FAIL', () => {
    const one = { ...CLEAN, liveCoupons: [FRESH.liveCoupons[0]!] };
    const kept = byId(run(one, envWith({ GO_LIVE_ACCEPT_DEMO_COUPONS: ' welcome30 ' })), 'db.demo_coupons');
    expect(kept.status).toBe('WARN');
    expect(kept.detail).toContain('WELCOME30');
    expect(kept.hint.length).toBeGreaterThan(10);

    const all = byId(run(FRESH, envWith({ GO_LIVE_ACCEPT_DEMO_COUPONS: 'WELCOME30' })), 'db.demo_coupons');
    expect(all.status).toBe('FAIL');
    expect(all.detail).toMatch(/chưa duyệt: FREESHIP.*XANH10/);
    expect(all.detail).toMatch(/đã chấp nhận giữ: WELCOME30/);
  });

  it('trùng mã demo nhưng không phải dòng migration tạo (id khác): WARN, không FAIL', () => {
    const r = run({ ...CLEAN, liveCoupons: [{ code: 'WELCOME30', endAt: '2027-03-01T00:00:00.000Z', fromMigration: false }] });
    expect(byId(r, 'db.demo_coupons').status).toBe('WARN');
  });

  it('evaluateDb nối thêm hai dòng khi ảnh chụp có demoData, không thêm gì khi thiếu', () => {
    const ctx = { phase: 'post-deploy' as const, env: GOOD_ENV };
    const ids = (rs: { id: string }[]) => rs.map((x) => x.id).filter((id) => id.startsWith('db.demo_'));
    expect(ids(evaluateDb(GOOD_DB, ctx))).toEqual([]);
    expect(ids(evaluateDb(dbWith({ demoData: FRESH }), ctx))).toEqual(['db.demo_products', 'db.demo_coupons']);
  });
});
