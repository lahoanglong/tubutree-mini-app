import { evaluateDb } from './db-checks';
import { evaluateDemoData, type DemoDataSnapshot } from './demo-data-checks';
import { GOOD_DB, GOOD_ENV, byId, dbWith, envWith } from './go-live.fixtures';
import type { Env } from './types';

const CLEAN: DemoDataSnapshot = { products: { found: 44, active: 0 }, activeVariations: 0, liveCoupons: [] };
const FRESH: DemoDataSnapshot = {
  products: { found: 44, active: 44 },
  activeVariations: 48,
  liveCoupons: [
    { code: 'WELCOME30', endAt: '2026-12-31T17:00:00.000Z', kind: 'migration' as const },
    { code: 'FREESHIP', endAt: '2026-12-31T17:00:00.000Z', kind: 'migration' as const },
    { code: 'XANH10', endAt: '2026-12-31T17:00:00.000Z', kind: 'migration' as const },
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

  it('DB vừa migrate: FAIL sản phẩm; ba mã chủ dự án giữ chỉ WARN, cách sửa chỉ lệnh dọn', () => {
    const r = run(FRESH);
    const p = byId(r, 'db.demo_products');
    expect(p.status).toBe('FAIL');
    expect(p.detail).toContain('44 sản phẩm');
    expect(p.detail).toContain('48 biến thể');
    expect(p.hint).toContain('prisma:cleanup-demo');
    const c = byId(r, 'db.demo_coupons');
    expect(c.status).toBe('WARN');
    expect(c.detail).toMatch(/đã chấp nhận giữ: WELCOME30.*FREESHIP.*XANH10/);
  });

  it('chỉ còn biến thể demo đang bán (sản phẩm đã tắt) vẫn FAIL: giờ vàng chỉ lọc theo biến thể', () => {
    expect(byId(run({ ...CLEAN, activeVariations: 2 }), 'db.demo_products').status).toBe('FAIL');
  });

  it('mã demo ngoài ba mã chủ dự án giữ vẫn FAIL, trừ khi chấp nhận giữ qua GO_LIVE_ACCEPT_DEMO_COUPONS', () => {
    const other = { code: 'DEMO50', endAt: '2026-12-31T17:00:00.000Z', kind: 'seed' as const };
    const snap = { ...CLEAN, liveCoupons: [...FRESH.liveCoupons, other] };
    const c = byId(run(snap), 'db.demo_coupons');
    expect(c.status).toBe('FAIL');
    expect(c.detail).toMatch(/chưa duyệt: DEMO50/);
    expect(c.detail).toMatch(/đã chấp nhận giữ: WELCOME30/);
    expect(c.hint).toContain('GO_LIVE_ACCEPT_DEMO_COUPONS');
    expect(byId(run(snap, envWith({ GO_LIVE_ACCEPT_DEMO_COUPONS: ' demo50 ' })), 'db.demo_coupons').status).toBe('WARN');
  });

  it('trước deploy (--phase=pre-deploy): còn demo là WARN vì bước dọn nằm trong cửa sổ deploy; sau deploy là FAIL', () => {
    const pre = evaluateDemoData(FRESH, GOOD_ENV, 'pre-deploy');
    expect(pre.map((x) => x.status)).toEqual(['WARN', 'WARN']);
    expect(byId(pre, 'db.demo_products').detail).toContain('bước 7c');
    expect(evaluateDemoData(FRESH, GOOD_ENV, 'post-deploy').map((x) => x.status)).toEqual(['FAIL', 'WARN']);
    expect(evaluateDemoData(CLEAN, GOOD_ENV, 'pre-deploy').map((x) => x.status)).toEqual(['PASS', 'PASS']);
    const ids = evaluateDb(dbWith({ demoData: FRESH }), { phase: 'pre-deploy', env: GOOD_ENV }).filter((x) => x.id.startsWith('db.demo_'));
    expect(ids.map((x) => x.status)).toEqual(['WARN', 'WARN']);
  });

  it('mã do seed tạo (id khác migration, điều kiện như bản demo): ba mã giữ chỉ WARN như mã migration', () => {
    const seeded = { ...CLEAN, liveCoupons: [{ code: 'WELCOME30', endAt: '2027-01-01T00:00:00.000Z', kind: 'seed' as const }] };
    const c = byId(run(seeded), 'db.demo_coupons');
    expect(c.status).toBe('WARN');
    expect(c.detail).toContain('WELCOME30');
  });

  it('chỉ trùng tên mã demo, điều kiện khác (mã thật): WARN và nêu đúng tên mã, không FAIL', () => {
    const r = run({ ...CLEAN, liveCoupons: [{ code: 'XANH10', endAt: '2027-03-01T00:00:00.000Z', kind: 'name-only' }] });
    const c = byId(r, 'db.demo_coupons');
    expect(c.status).toBe('WARN');
    expect(c.detail).toMatch(/điều kiện khác bản demo.*XANH10/);
    const mixed = byId(
      run({ ...CLEAN, liveCoupons: [{ code: 'FREESHIP', endAt: '2027-01-01T00:00:00.000Z', kind: 'seed' }, { code: 'XANH10', endAt: '2027-03-01T00:00:00.000Z', kind: 'name-only' }] }),
      'db.demo_coupons',
    );
    expect(mixed.status).toBe('WARN');
    expect(mixed.detail).toMatch(/đã chấp nhận giữ: FREESHIP.*điều kiện khác bản demo.*XANH10/);
  });

  it('evaluateDb nối thêm hai dòng khi ảnh chụp có demoData, không thêm gì khi thiếu', () => {
    const ctx = { phase: 'post-deploy' as const, env: GOOD_ENV };
    const ids = (rs: { id: string }[]) => rs.map((x) => x.id).filter((id) => id.startsWith('db.demo_'));
    expect(ids(evaluateDb(GOOD_DB, ctx))).toEqual([]);
    expect(ids(evaluateDb(dbWith({ demoData: FRESH }), ctx))).toEqual(['db.demo_products', 'db.demo_coupons']);
  });
});
