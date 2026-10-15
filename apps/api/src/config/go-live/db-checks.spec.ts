import { estimateOrdersLockSeconds, evaluateDb, HEAVY_MIGRATIONS, recommendedWindowSeconds, REQUIRED_MIGRATIONS } from './db-checks';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GOOD_DB, GOOD_ENV, byId, dbWith, envWith } from './go-live.fixtures';
import type { DbSnapshot } from './db-checks';
import type { Env, GoLivePhase } from './types';

const run = (s: DbSnapshot, phase: GoLivePhase = 'post-deploy', env: Env = GOOD_ENV) => evaluateDb(s, { phase, env });
const status = (s: DbSnapshot, id: string, phase: GoLivePhase = 'post-deploy', env: Env = GOOD_ENV) => byId(run(s, phase, env), id).status;

describe('evaluateDb', () => {
  it('DB tốt: mọi dòng PASS', () => {
    expect(run(GOOD_DB).filter((r) => r.status !== 'PASS')).toEqual([]);
    expect(run(GOOD_DB, 'pre-deploy').filter((r) => r.status !== 'PASS')).toEqual([]);
  });

  it('mọi WARN/FAIL đều có cách sửa, PASS thì không', () => {
    const worst = dbWith({ adminCount: 0, unfinishedMigrations: ['x'], refill: { totalRows: 0, activeRows: 0, tableExists: true }, znsTemplates: [] });
    for (const r of run(worst)) {
      if (r.status === 'PASS') expect(r.hint).toBe('');
      else expect(r.hint.length).toBeGreaterThan(10);
    }
  });

  describe('migration', () => {
    it('chạy dở thì FAIL ở cả hai giai đoạn', () => {
      const s = dbWith({ unfinishedMigrations: ['20261015150000_r8_multi_reviews_unique_per_order'] });
      expect(status(s, 'db.migrations_failed')).toBe('FAIL');
      expect(status(s, 'db.migrations_failed', 'pre-deploy')).toBe('FAIL');
    });

    it('thiếu migration: FAIL sau deploy, WARN trước deploy', () => {
      const s = dbWith({ appliedMigrations: GOOD_DB.appliedMigrations.slice(0, 2) });
      expect(status(s, 'db.migrations_pending')).toBe('FAIL');
      expect(status(s, 'db.migrations_pending', 'pre-deploy')).toBe('WARN');
      expect(byId(run(s), 'db.migrations_pending').detail).toContain('thiếu 3');
    });

    it('nêu bớt khi quá nhiều tên', () => {
      const many = Array.from({ length: 9 }, (_, i) => `2026${i}_m`);
      const s = dbWith({ appliedMigrations: [], expectedMigrations: many });
      expect(byId(run(s), 'db.migrations_pending').detail).toContain('và 5 cái nữa');
    });

    it('DB đi trước mã thì WARN', () => {
      const s = dbWith({ appliedMigrations: [...GOOD_DB.appliedMigrations, '20261201000000_future'] });
      const r = byId(run(s), 'db.migrations_ahead');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('20261201000000_future');
    });

    it('ba migration của đợt: image thiếu thì FAIL kể cả trước deploy', () => {
      const without = GOOD_DB.expectedMigrations.filter((m) => m !== REQUIRED_MIGRATIONS[1]);
      const s = dbWith({ expectedMigrations: without });
      expect(status(s, 'db.required_migrations')).toBe('FAIL');
      expect(status(s, 'db.required_migrations', 'pre-deploy')).toBe('FAIL');
    });

    it('ba migration của đợt: chưa áp thì FAIL sau deploy, WARN trước deploy', () => {
      const s = dbWith({ appliedMigrations: GOOD_DB.appliedMigrations.filter((m) => m !== REQUIRED_MIGRATIONS[2]) });
      expect(status(s, 'db.required_migrations')).toBe('FAIL');
      expect(status(s, 'db.required_migrations', 'pre-deploy')).toBe('WARN');
    });
  });

  describe('khoá bảng orders', () => {
    const unapplied = (orderCount: number) => dbWith({ orderCount, appliedMigrations: GOOD_DB.appliedMigrations.filter((m) => m !== REQUIRED_MIGRATIONS[0]) });

    it.each([
      [0, 2],
      [49_999, 2],
      [50_000, 3],
      [300_000, 14],
      [600_000, 28],
      [1_000_000, 47],
    ])('%i đơn thì ước tính %i giây', (n, seconds) => {
      expect(estimateOrdersLockSeconds(n)).toBe(seconds);
    });

    it('cửa sổ nên xin: gấp 5 lần, tối thiểu 2 phút', () => {
      expect(recommendedWindowSeconds(1_000)).toBe(120);
      expect(recommendedWindowSeconds(300_000)).toBe(120);
      expect(recommendedWindowSeconds(1_000_000)).toBe(235);
    });

    it('dưới 50 nghìn đơn: PASS và nêu cửa sổ', () => {
      const r = byId(run(unapplied(20_000)), 'db.orders_lock');
      expect(r.status).toBe('PASS');
      expect(r.detail).toContain('~2 giây');
      expect(r.detail).toContain('≥ 2 phút');
    });

    it('từ 50 nghìn đơn: WARN kèm số liệu', () => {
      const r = byId(run(unapplied(300_000)), 'db.orders_lock');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('~14 giây');
    });

    it('migration đã áp: PASS dù nhiều đơn', () => {
      const r = byId(run(dbWith({ orderCount: 900_000 })), 'db.orders_lock');
      expect(r.status).toBe('PASS');
      expect(r.detail).toContain('không còn rủi ro');
    });
  });

  describe('PROD cũ hơn: nhiều migration chờ áp', () => {
    const [R6] = REQUIRED_MIGRATIONS;
    const P1 = '20261014003644_p1_pancake_outbound_sync_state';
    const P4 = '20261014150000_p4_admin_ops_search';
    const P8 = '20261014003831_p8_seller_merchant_fulfilment';
    const PD3 = '20261012110000_pd3_xu_to_points';
    const required: readonly string[] = REQUIRED_MIGRATIONS;
    const behind = (orderCount: number, extra: string[]) => {
      const expectedMigrations = [...extra, ...GOOD_DB.expectedMigrations];
      const appliedMigrations = GOOD_DB.appliedMigrations.filter((m) => !required.includes(m));
      return dbWith({ orderCount, expectedMigrations, appliedMigrations });
    };

    it('mọi tên migration nặng đều có thật trong thư mục prisma/migrations', () => {
      const dirs = new Set(readdirSync(join(__dirname, '../../../prisma/migrations')));
      for (const h of HEAVY_MIGRATIONS) expect(dirs.has(h.name)).toBe(true);
    });

    it('ước tính nhân theo số migration nặng trên orders', () => {
      expect(estimateOrdersLockSeconds(300_000, 1)).toBe(14);
      expect(estimateOrdersLockSeconds(300_000, 4)).toBe(56);
      expect(estimateOrdersLockSeconds(300_000, 0)).toBe(14);
      expect(recommendedWindowSeconds(300_000, 4)).toBe(280);
    });

    it('chỉ ba migration của đợt chờ áp: db.pending_scope PASS, ước tính như cũ', () => {
      const s = dbWith({ appliedMigrations: GOOD_DB.appliedMigrations.filter((m) => !required.includes(m)), orderCount: 300_000 });
      expect(status(s, 'db.pending_scope', 'pre-deploy')).toBe('PASS');
      expect(byId(run(s, 'pre-deploy'), 'db.orders_lock').detail).toContain('~14 giây');
    });

    it('thêm p1, p4, p8, pd3: db.pending_scope WARN, nêu tên migration nặng và chỉ đường 7.3', () => {
      const s = behind(300_000, [PD3, P1, P8, P4]);
      const r = byId(run(s, 'pre-deploy'), 'db.pending_scope');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('7 migration chờ áp, 4 cái nằm ngoài');
      for (const n of [PD3, P1, P8, P4, R6]) expect(r.detail).toContain(n);
      expect(r.hint).toContain('7.3');
    });

    it('thêm migration không nặng: WARN, không nêu danh sách nặng thừa', () => {
      const extra = '20261013172011_p6_promo_abuse_coupon_active_code';
      const s = dbWith({ orderCount: 1_000, expectedMigrations: [extra, ...GOOD_DB.expectedMigrations] });
      const r = byId(run(s, 'pre-deploy'), 'db.pending_scope');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('1 migration chờ áp, 1 cái nằm ngoài');
      expect(r.detail).not.toContain('nặng:');
    });

    it('db.orders_lock cộng các migration nặng trên orders, không cộng pd3', () => {
      const s = behind(300_000, [PD3, P1, P8, P4]);
      const r = byId(run(s, 'pre-deploy'), 'db.orders_lock');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('~56 giây');
      expect(r.detail).toContain('4 migration nặng trên orders');
      expect(r.detail).not.toContain(PD3);
      expect(r.detail).toContain('≥ 5 phút');
    });

    it('sau deploy không có dòng db.pending_scope', () => {
      expect(run(GOOD_DB).some((r) => r.id === 'db.pending_scope')).toBe(false);
      expect(run(behind(1_000, [P1]), 'post-deploy').some((r) => r.id === 'db.pending_scope')).toBe(false);
    });
  });

  describe('điểm nhận vỏ chai', () => {
    it('có điểm đang bật thì PASS', () => expect(status(GOOD_DB, 'db.refill_location')).toBe('PASS'));
    it('chỉ có địa chỉ cũ, bảng chưa có dòng nào thì WARN', () => {
      const s = dbWith({ refill: { totalRows: 0, activeRows: 0, tableExists: true }, configs: { 'refill.pickup_address': '12 Đường X, Quận 1' } });
      expect(status(s, 'db.refill_location')).toBe('WARN');
    });
    it('bảng có điểm nhưng tắt hết thì FAIL dù còn địa chỉ cũ', () => {
      const s = dbWith({ refill: { totalRows: 2, activeRows: 0, tableExists: true }, configs: { 'refill.pickup_address': '12 Đường X' } });
      expect(status(s, 'db.refill_location')).toBe('FAIL');
    });
    it('không có gì thì FAIL', () => {
      expect(status(dbWith({ refill: { totalRows: 0, activeRows: 0, tableExists: true } }), 'db.refill_location')).toBe('FAIL');
      const blank = dbWith({ refill: { totalRows: 0, activeRows: 0, tableExists: true }, configs: { 'refill.pickup_address': '   ' } });
      expect(status(blank, 'db.refill_location')).toBe('FAIL');
    });

    describe('DB cũ, bảng refill_pickup_locations chưa có (migration 20261015070000 chưa áp)', () => {
      const noTable = (configs: Record<string, unknown> = {}, dropConfigs: string[] = []) =>
        dbWith({ refill: { totalRows: 0, activeRows: 0, tableExists: false }, configs, dropConfigs });

      it('trước deploy: WARN dù không có khoá refill.pickup_address', () => {
        const r = byId(run(noTable({}, ['refill.pickup_address']), 'pre-deploy'), 'db.refill_location');
        expect(r.status).toBe('WARN');
        expect(r.detail).toContain('chưa có địa chỉ cũ');
        expect(r.hint.length).toBeGreaterThan(10);
      });
      it('trước deploy: WARN khi khoá có nhưng rỗng (migration p9 tạo sẵn giá trị rỗng)', () => {
        expect(status(noTable({ 'refill.pickup_address': '' }), 'db.refill_location', 'pre-deploy')).toBe('WARN');
      });
      it('trước deploy: WARN và nói địa chỉ cũ sẽ thành điểm đầu tiên khi có địa chỉ', () => {
        const r = byId(run(noTable({ 'refill.pickup_address': '12 Đường X, Quận 1' }), 'pre-deploy'), 'db.refill_location');
        expect(r.status).toBe('WARN');
        expect(r.detail).toContain('điểm đầu tiên');
      });
      it('sau deploy: bảng vẫn chưa có và không có địa chỉ thì FAIL (migration không chạy là lỗi thật)', () => {
        expect(status(noTable({}, ['refill.pickup_address']), 'db.refill_location', 'post-deploy')).toBe('FAIL');
        expect(status(noTable({}, ['refill.pickup_address']), 'db.refill_location')).toBe('FAIL');
      });
      it('sau deploy: chỉ có địa chỉ cũ thì WARN như trước', () => {
        expect(status(noTable({ 'refill.pickup_address': '12 Đường X' }), 'db.refill_location', 'post-deploy')).toBe('WARN');
      });
    });

    describe('bảng đã có', () => {
      const empty = dbWith({ refill: { totalRows: 0, activeRows: 0, tableExists: true }, dropConfigs: ['refill.pickup_address'] });
      it('rỗng thì FAIL ở cả hai giai đoạn (admin thêm được điểm trước khi mở bán)', () => {
        expect(status(empty, 'db.refill_location', 'pre-deploy')).toBe('FAIL');
        expect(status(empty, 'db.refill_location', 'post-deploy')).toBe('FAIL');
      });
      it('có điểm đang bật thì PASS ở cả hai giai đoạn', () => {
        expect(status(GOOD_DB, 'db.refill_location', 'pre-deploy')).toBe('PASS');
        expect(status(GOOD_DB, 'db.refill_location', 'post-deploy')).toBe('PASS');
      });
    });
  });

  describe('ngưỡng ops.*', () => {
    it('thiếu khoá thì WARN và nêu mặc định', () => {
      const r = byId(run(dbWith({ dropConfigs: ['ops.alert_unsynced_minutes'] })), 'db.ops_thresholds');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('ops.alert_unsynced_minutes chưa có (dùng mặc định 30)');
    });
    it.each([['không phải số', 'abc'], ['bằng 0', 0], ['âm', -3], ['null', null]])('giá trị %s thì WARN', (_l, v) => {
      expect(status(dbWith({ configs: { 'ops.alert_stuck_orders': v } }), 'db.ops_thresholds')).toBe('WARN');
    });
    it('quá lỏng hoặc quá chặt thì WARN', () => {
      expect(status(dbWith({ configs: { 'ops.alert_unsynced_minutes': 1000 } }), 'db.ops_thresholds')).toBe('WARN');
      expect(status(dbWith({ configs: { 'ops.alert_unsynced_minutes': 1 } }), 'db.ops_thresholds')).toBe('WARN');
    });
    it('đủ và hợp lý thì PASS', () => expect(status(GOOD_DB, 'db.ops_thresholds')).toBe('PASS'));
  });

  describe('phí vận chuyển', () => {
    it('sai kiểu hoặc âm thì FAIL', () => {
      expect(status(dbWith({ configs: { 'shipping.free_threshold': '200000' } }), 'db.shipping_rates')).toBe('FAIL');
      expect(status(dbWith({ configs: { 'shipping.flat_fee_below_threshold': -1 } }), 'db.shipping_rates')).toBe('FAIL');
    });
    it('thiếu thì WARN', () => expect(status(dbWith({ dropConfigs: ['shipping.free_threshold'] }), 'db.shipping_rates')).toBe('WARN'));
    it('đủ thì PASS', () => expect(byId(run(GOOD_DB), 'db.shipping_rates').detail).toContain('freeship từ'));
  });

  describe('phí sàn đối tác', () => {
    it.each([['15 thay vì 0.15', 15], ['bằng 1', 1], ['âm', -0.1], ['chuỗi', '0.15']])('%s thì FAIL', (_l, v) => {
      expect(status(dbWith({ configs: { 'merchant.commission_pct': v } }), 'db.merchant_terms')).toBe('FAIL');
    });
    it('phí ship đối tác âm thì FAIL', () => expect(status(dbWith({ configs: { 'merchant.default_shipping_fee': -5 } }), 'db.merchant_terms')).toBe('FAIL'));
    it('thiếu phí sàn thì WARN', () => expect(status(dbWith({ dropConfigs: ['merchant.commission_pct'] }), 'db.merchant_terms')).toBe('WARN'));
    it('0% thì WARN', () => expect(status(dbWith({ configs: { 'merchant.commission_pct': 0 } }), 'db.merchant_terms')).toBe('WARN'));
    it('0.15 thì PASS và hiện 15%', () => {
      const r = byId(run(GOOD_DB), 'db.merchant_terms');
      expect(r.status).toBe('PASS');
      expect(r.detail).toContain('phí sàn 15%');
    });
    it('chưa ghi phí ship đối tác thì hiện "mặc định"', () => {
      expect(byId(run(dbWith({ dropConfigs: ['merchant.default_shipping_fee'] })), 'db.merchant_terms').detail).toContain('mặc định');
    });
    it('hiện đúng phần thập phân', () => expect(byId(run(dbWith({ configs: { 'merchant.commission_pct': 0.125 } })), 'db.merchant_terms').detail).toContain('12.5%'));
  });

  describe('số ngày giữ tiền', () => {
    it('chưa ghi thì PASS (mặc định 7)', () => expect(status(dbWith({ dropConfigs: ['merchant.settlement_hold_days'] }), 'db.settlement_hold')).toBe('PASS'));
    it('sai kiểu, âm, hoặc không nguyên thì FAIL', () => {
      for (const v of ['7', -1, 3.5]) expect(status(dbWith({ configs: { 'merchant.settlement_hold_days': v } }), 'db.settlement_hold')).toBe('FAIL');
    });
    it('khác 7 thì WARN', () => expect(status(dbWith({ configs: { 'merchant.settlement_hold_days': 3 } }), 'db.settlement_hold')).toBe('WARN'));
    it('đúng 7 thì PASS', () => expect(status(GOOD_DB, 'db.settlement_hold')).toBe('PASS'));
  });

  describe('mốc đối soát giao hộ', () => {
    it('thiếu thì WARN', () => expect(status(dbWith({ dropConfigs: ['merchant.consignment_settle_from'] }), 'db.consignment_from')).toBe('WARN'));
    it('không phải ISO 8601 có thật thì WARN', () => {
      expect(status(dbWith({ configs: { 'merchant.consignment_settle_from': '2026-13-01' } }), 'db.consignment_from')).toBe('WARN');
      expect(status(dbWith({ configs: { 'merchant.consignment_settle_from': 20261020 } }), 'db.consignment_from')).toBe('WARN');
    });
    it('hợp lệ thì PASS', () => expect(byId(run(GOOD_DB), 'db.consignment_from').detail).toBe('từ 2026-10-20T00:00:00.000Z'));
  });

  describe('tài khoản ngân hàng', () => {
    it.each([
      ['thiếu BIN', { 'payment.bank_bin': '' }],
      ['BIN sai độ dài', { 'payment.bank_bin': '9704' }],
      ['số tài khoản có chữ', { 'payment.bank_account_no': '12ab34' }],
      ['thiếu tên chủ tài khoản', { 'payment.bank_account_name': '  ' }],
    ])('%s thì FAIL', (_l, configs) => {
      expect(status(dbWith({ configs }), 'db.bank_account')).toBe('FAIL');
    });
    it('chưa có khoá nào thì FAIL', () => {
      expect(status(dbWith({ dropConfigs: ['payment.bank_bin', 'payment.bank_account_no', 'payment.bank_account_name'] }), 'db.bank_account')).toBe('FAIL');
    });
    it('còn số mặc định của seed thì WARN, chỉ in 4 số cuối', () => {
      const r = byId(run(dbWith({ configs: { 'payment.bank_account_no': '9984606774' } })), 'db.bank_account');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('6774');
      expect(r.detail).not.toContain('9984606774');
    });
    it('đủ thì PASS và không in đầy đủ số tài khoản', () => {
      const r = byId(run(GOOD_DB), 'db.bank_account');
      expect(r.status).toBe('PASS');
      expect(r.detail).toContain('9012');
      expect(r.detail).not.toContain('0123456789012');
    });
  });

  describe('trần COD', () => {
    it('mã khác 5.000.000đ thì FAIL', () => expect(status(dbWith({ codMaxPerOrder: 3_000_000 }), 'db.cod_cap')).toBe('FAIL'));
    it('đúng 5.000.000đ thì PASS và nói rõ là hằng số trong mã', () => {
      const r = byId(run(GOOD_DB), 'db.cod_cap');
      expect(r.status).toBe('PASS');
      expect(r.detail).toContain('hằng số trong mã');
    });
  });

  describe('công tắc thu gom Gomdon', () => {
    const noCreds = envWith({ GOMDON_PHONE: '', GOMDON_PASSWORD: '' });
    it('bật và có tài khoản thì PASS', () => expect(status(GOOD_DB, 'db.gomdon_toggle')).toBe('PASS'));
    it('bật mà chưa có tài khoản thì WARN', () => expect(status(GOOD_DB, 'db.gomdon_toggle', 'post-deploy', noCreds)).toBe('WARN'));
    it('tắt mà đã có tài khoản thì WARN', () => {
      expect(status(dbWith({ configs: { 'shipping.gomdon.recycling_enabled': false } }), 'db.gomdon_toggle')).toBe('WARN');
    });
    it('tắt và chưa có tài khoản thì PASS', () => {
      expect(status(dbWith({ configs: { 'shipping.gomdon.recycling_enabled': false } }), 'db.gomdon_toggle', 'post-deploy', noCreds)).toBe('PASS');
      expect(status(dbWith({ dropConfigs: ['shipping.gomdon.recycling_enabled'] }), 'db.gomdon_toggle', 'post-deploy', noCreds)).toBe('PASS');
    });
    it('chuỗi "true" không phải boolean nên WARN', () => {
      expect(status(dbWith({ configs: { 'shipping.gomdon.recycling_enabled': 'true' } }), 'db.gomdon_toggle')).toBe('WARN');
    });
  });

  describe('kho lấy hàng Gomdon', () => {
    it('không xét khi thu gom tắt và chưa có tài khoản', () => {
      const s = dbWith({ configs: { 'shipping.gomdon.recycling_enabled': false } });
      expect(run(s, 'post-deploy', envWith({ GOMDON_PHONE: '', GOMDON_PASSWORD: '' })).some((r) => r.id === 'db.gomdon_warehouse')).toBe(false);
    });
    it('thiếu khoá cấu hình thì WARN', () => expect(status(dbWith({ dropConfigs: ['shipping.gomdon.config'] }), 'db.gomdon_warehouse')).toBe('WARN'));
    it('thiếu trường thì FAIL', () => {
      const cfg = { defaultWarehouse: { name: 'Kho', phone: '0965573541', address: '1 A', ward: '', district: 'Q', province: 'T' } };
      const r = byId(run(dbWith({ configs: { 'shipping.gomdon.config': cfg } })), 'db.gomdon_warehouse');
      expect(r.status).toBe('FAIL');
      expect(r.detail).toContain('ward');
    });
    it('cấu hình không phải object thì FAIL', () => expect(status(dbWith({ configs: { 'shipping.gomdon.config': 'abc' } }), 'db.gomdon_warehouse')).toBe('FAIL'));
    it('còn kho mặc định của seed thì WARN', () => {
      const cfg = { defaultWarehouse: { name: 'Fuwa3e Tubu HCM', phone: '0965573541', address: 'Golf Park', ward: 'Phường Long Bình', district: 'Thành phố Thủ Đức', province: 'Thành phố Hồ Chí Minh' } };
      expect(status(dbWith({ configs: { 'shipping.gomdon.config': cfg } }), 'db.gomdon_warehouse')).toBe('WARN');
    });
    it('đủ thì PASS', () => expect(status(GOOD_DB, 'db.gomdon_warehouse')).toBe('PASS'));
  });

  describe('tài khoản admin', () => {
    it('có ADMIN thì PASS', () => expect(status(GOOD_DB, 'db.admin_user')).toBe('PASS'));
    it('chưa có nhưng có quyền cấp theo SĐT chờ thì WARN', () => expect(status(dbWith({ adminCount: 0, pendingAdminGrants: 1 }), 'db.admin_user')).toBe('WARN'));
    it('không có gì thì FAIL, hint nêu grant-admin', () => {
      const r = byId(run(dbWith({ adminCount: 0 })), 'db.admin_user');
      expect(r.status).toBe('FAIL');
      expect(r.hint).toContain('grant-admin');
    });
  });

  describe('mẫu ZNS', () => {
    it('không có mẫu ZNS nào thì WARN', () => expect(status(dbWith({ znsTemplates: [] }), 'db.zns_templates')).toBe('WARN'));
    it('mã sai dạng thì FAIL', () => {
      const s = dbWith({ znsTemplates: [{ code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: 'abc-12' }] });
      expect(status(s, 'db.zns_templates')).toBe('FAIL');
    });
    it('thiếu mã thì WARN và nêu mã mẫu', () => {
      const s = dbWith({
        znsTemplates: [
          { code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: null },
          { code: 'ORDER_SHIPPING', channel: 'ZNS', zaloTemplateId: '  ' },
          { code: 'WELCOME', channel: 'ZNS', zaloTemplateId: '555' },
        ],
      });
      const r = byId(run(s), 'db.zns_templates');
      expect(r.status).toBe('WARN');
      expect(r.detail).toContain('2/3');
      expect(r.detail).toContain('ORDER_CONFIRMED');
    });
    it('kênh khác ZNS không bị tính', () => {
      const s = dbWith({ znsTemplates: [{ code: 'X', channel: 'INAPP', zaloTemplateId: null }, { code: 'Y', channel: 'ZNS', zaloTemplateId: '1' }] });
      expect(byId(run(s), 'db.zns_templates').status).toBe('PASS');
    });
  });
});
