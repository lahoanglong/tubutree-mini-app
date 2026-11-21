import { evaluateBackup } from '../../../config/go-live/backup-checks';
import { evaluateDb } from '../../../config/go-live/db-checks';
import { evaluateEnv } from '../../../config/go-live/env-checks';
import { GOOD_BACKUP, GOOD_DB, GOOD_ENV, GOOD_REDIS, dbWith } from '../../../config/go-live/go-live.fixtures';
import { evaluateRedis } from '../../../config/go-live/redis-checks';
import { buildCards, cardOf, COCKPIT_CARD_KEYS } from './golive-cards';
import { CATALOG_SYNC_STALE_HOURS, REFILL_PAIRS_TARGET, cockpitMetrics, evaluateCockpitExtras, type CockpitExtrasSnapshot } from './golive-extras';
import { isSecretEnvName, scrubSecrets, secretValues } from './golive-secret-scrub';

const NOW = new Date('2026-11-21T05:00:00Z');
const GOOD_X: CockpitExtrasSnapshot = {
  catalog: { activeProducts: 120, activeVariations: 180, missingIngredients: 0, customStory: 12, unlinkedVariations: 0 },
  refill: { enabled: true, paired: 16, near: 0, size: 0, ambiguous: 0 },
  pancake: { configured: true, lastWebhookAt: new Date('2026-11-21T04:00:00Z'), lastPushOkAt: null, catalogLastOkAt: new Date('2026-11-21T02:00:00Z'), catalogLastErrorAt: null },
  company: { hasRegistrationNumber: true, hasBctNoticeUrl: true },
};
const withX = (patch: Partial<{ [K in keyof CockpitExtrasSnapshot]: Partial<NonNullable<CockpitExtrasSnapshot[K]>> | null }>): CockpitExtrasSnapshot =>
  ({
    catalog: { ...GOOD_X.catalog, ...(patch.catalog ?? {}) },
    refill: patch.refill === null ? null : { ...GOOD_X.refill!, ...(patch.refill ?? {}) },
    pancake: { ...GOOD_X.pancake, ...(patch.pancake ?? {}) },
    company: { ...GOOD_X.company, ...(patch.company ?? {}) },
  }) as CockpitExtrasSnapshot;
const row = (x: CockpitExtrasSnapshot, id: string, db: typeof GOOD_DB | null = GOOD_DB) => evaluateCockpitExtras(x, db, NOW).find((r) => r.id === id)!;
const GOOD_DB_ALL_ZNS = dbWith({
  znsTemplates: [
    { code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: '111' },
    { code: 'ORDER_SHIPPING', channel: 'ZNS', zaloTemplateId: '222' },
    { code: 'REORDER_REMINDER_REFILL', channel: 'ZNS', zaloTemplateId: '333' },
  ],
  configs: { 'waste.lane_mailin_enabled': false },
});

describe('golive-cards: 6 thẻ', () => {
  it('mỗi dòng của go-live:check vào đúng thẻ; dòng chưa biết rơi về thẻ hạ tầng, không bị giấu', () => {
    expect(cardOf('env.phone_hmac')).toBe('infra');
    expect(cardOf('db.migrations_pending')).toBe('infra');
    expect(cardOf('redis.reachable')).toBe('infra');
    expect(cardOf('backup.recent')).toBe('infra');
    expect(cardOf('env.zalo.oa')).toBe('zalo');
    expect(cardOf('db.zns_templates')).toBe('zalo');
    expect(cardOf('env.pancake.webhook_secret')).toBe('pancake');
    expect(cardOf('env.gomdon.credentials')).toBe('waste');
    expect(cardOf('db.waste_point')).toBe('waste');
    expect(cardOf('db.demo_products')).toBe('catalog');
    expect(cardOf('db.legal_policies')).toBe('legal');
    expect(cardOf('db.company_identity')).toBe('legal');
    expect(cardOf('env.cookie_domain')).toBe('legal');
    expect(cardOf('something.new')).toBe('infra');
  });

  it('chạy đủ bộ kiểm thật trên fixture: tổng dòng các thẻ bằng tổng dòng vào, thẻ lấy mức nặng nhất, FAIL lên đầu', () => {
    const results = [
      ...evaluateEnv(GOOD_ENV),
      ...evaluateDb(dbWith({ unfinishedMigrations: ['20261121130000_x'] }), { phase: 'post-deploy', env: GOOD_ENV }),
      ...evaluateRedis(GOOD_REDIS),
      ...evaluateBackup(GOOD_BACKUP, GOOD_ENV),
      ...evaluateCockpitExtras(GOOD_X, GOOD_DB_ALL_ZNS, NOW),
    ];
    const cards = buildCards(results);
    expect(cards.map((c) => c.key)).toEqual([...COCKPIT_CARD_KEYS]);
    expect(cards.reduce((n, c) => n + c.rows.length, 0)).toBe(results.length);
    const infra = cards.find((c) => c.key === 'infra')!;
    expect(infra.status).toBe('FAIL');
    expect(infra.rows[0]!.id).toBe('db.migrations_failed');
    for (const c of cards) expect(c.counts.PASS + c.counts.WARN + c.counts.FAIL).toBe(c.rows.length);
  });
});

describe('golive-extras: dòng riêng của bảng kiểm', () => {
  it('đủ cả: mọi dòng riêng PASS', () => {
    expect(evaluateCockpitExtras(GOOD_X, GOOD_DB_ALL_ZNS, NOW).filter((r) => r.status !== 'PASS')).toEqual([]);
  });

  it(`Refill: dưới ${REFILL_PAIRS_TARGET} cặp, hay còn gợi ý gần đúng/dung tích, là WARN; không đọc được bảng cặp cũng WARN`, () => {
    expect(row(withX({ refill: { paired: 15 } }), 'cockpit.catalog.refill_pairs').status).toBe('WARN');
    expect(row(withX({ refill: { near: 2 } }), 'cockpit.catalog.refill_pairs').detail).toContain('2 gợi ý gần đúng');
    expect(row(withX({ refill: { size: 1 } }), 'cockpit.catalog.refill_pairs').status).toBe('WARN');
    expect(row(withX({ refill: null }), 'cockpit.catalog.refill_pairs').status).toBe('WARN');
  });

  it('INCI thiếu, biến thể chưa liên kết Pancake, không có sản phẩm đang bán', () => {
    expect(row(withX({ catalog: { missingIngredients: 7 } }), 'cockpit.catalog.inci').detail).toBe('thiếu 7/120');
    expect(row(withX({ catalog: { unlinkedVariations: 3 } }), 'cockpit.pancake.unlinked_variants').status).toBe('WARN');
    expect(row(withX({ catalog: { activeProducts: 0 } }), 'cockpit.catalog.active_skus').status).toBe('FAIL');
  });

  it(`đồng bộ Pancake: chưa cấu hình, chưa từng đồng bộ, lượt gần nhất lỗi, hay quá ${CATALOG_SYNC_STALE_HOURS} giờ là WARN`, () => {
    const id = 'cockpit.pancake.recent_sync';
    expect(row(withX({ pancake: { configured: false } }), id).status).toBe('WARN');
    expect(row(withX({ pancake: { catalogLastOkAt: null } }), id).status).toBe('WARN');
    expect(row(withX({ pancake: { catalogLastErrorAt: new Date('2026-11-21T03:00:00Z') } }), id).detail).toContain('bị lỗi');
    expect(row(withX({ pancake: { catalogLastOkAt: new Date(NOW.getTime() - (CATALOG_SYNC_STALE_HOURS + 1) * 3_600_000) } }), id).status).toBe('WARN');
    expect(row(GOOD_X, id).detail).toBe('danh mục 3 giờ trước, webhook 1 giờ trước, đẩy đơn chưa có');
  });

  it('ZNS bắt buộc: thiếu mã Zalo hay mã sai dạng là WARN và nêu đúng mẫu thiếu', () => {
    const db = dbWith({ znsTemplates: [{ code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: '111' }, { code: 'ORDER_SHIPPING', channel: 'ZNS', zaloTemplateId: 'abc' }] });
    const r = row(GOOD_X, 'cockpit.zns.required', db);
    expect(r.status).toBe('WARN');
    expect(r.detail).toBe('1/3 mẫu có mã; còn thiếu: ORDER_SHIPPING, REORDER_REMINDER_REFILL');
  });

  it('Gửi về kho: false là PASS; true, thiếu dòng hay sai kiểu là WARN (bảng kiểm chỉ đọc, không đổi cờ)', () => {
    const id = 'cockpit.waste.lane_mailin';
    expect(row(GOOD_X, id, dbWith({ configs: { 'waste.lane_mailin_enabled': false } })).status).toBe('PASS');
    expect(row(GOOD_X, id, dbWith({ configs: { 'waste.lane_mailin_enabled': true } })).status).toBe('WARN');
    expect(row(GOOD_X, id, dbWith({ dropConfigs: ['waste.lane_mailin_enabled'] })).status).toBe('WARN');
    expect(row(GOOD_X, id, dbWith({ configs: { 'waste.lane_mailin_enabled': 'false' } })).status).toBe('WARN');
  });

  it('pháp lý: thiếu số ĐKKD hay link BCT là WARN', () => {
    expect(row(withX({ company: { hasRegistrationNumber: false } }), 'cockpit.legal.business_registration').status).toBe('WARN');
    expect(row(withX({ company: { hasBctNoticeUrl: false } }), 'cockpit.legal.bct_notice').status).toBe('WARN');
  });

  it('DB không đọc được: dòng ZNS và Gửi về kho WARN, số đầu thẻ ghi "không đọc được" thay vì số giả', () => {
    expect(row(GOOD_X, 'cockpit.zns.required', null).status).toBe('WARN');
    expect(row(GOOD_X, 'cockpit.waste.lane_mailin', null).status).toBe('WARN');
    const m = cockpitMetrics(GOOD_X, { db: null, redis: null, backup: null }, NOW);
    expect(m.infra![0]).toEqual({ label: 'Migration đã áp', value: 'không đọc được' });
    expect(m.legal![0]).toEqual({ label: 'Chính sách đã lưu', value: 'không đọc được' });
  });

  it('số đầu thẻ đọc từ ảnh chụp: migration, backup, Refill, chính sách', () => {
    const m = cockpitMetrics(GOOD_X, { db: GOOD_DB, redis: GOOD_REDIS, backup: GOOD_BACKUP }, NOW);
    expect(m.infra).toEqual([
      { label: 'Migration đã áp', value: `${GOOD_DB.appliedMigrations.length}/${GOOD_DB.expectedMigrations.length}` },
      { label: 'Redis', value: 'kết nối được' },
      { label: 'Bản backup mới nhất', value: '7 giờ trước' },
    ]);
    expect(m.catalog).toContainEqual({ label: 'Cặp Refill', value: '16/16' });
    expect(m.legal![0]!.value).toBe('5/5');
  });
});

describe('golive-secret-scrub', () => {
  it('nhận đúng tên biến bí mật, không nhầm biến thường', () => {
    for (const n of ['JWT_ACCESS_SECRET', 'PANCAKE_API_KEY', 'ZALOPAY_KEY1', 'ANTIGRAVITY_GATEWAY_KEY', 'ZALO_OA_ACCESS_TOKEN', 'GOMDON_PASSWORD', 'SMTP_PASS', 'DATABASE_URL', 'REDIS_URL', 'OPS_ALERT_WEBHOOK_URL', 'GOMDON_PHONE']) {
      expect([n, isSecretEnvName(n)]).toEqual([n, true]);
    }
    for (const n of ['NODE_ENV', 'ZALO_APP_ID', 'PANCAKE_SHOP_ID', 'CORS_ORIGINS', 'ZALOPAY_ENDPOINT', 'OPS_ALERT_ENV_LABEL']) {
      expect([n, isSecretEnvName(n)]).toEqual([n, false]);
    }
  });

  it('thay mọi chỗ xuất hiện (kể cả mật khẩu trong chuỗi kết nối) ở mọi tầng của object, giữ nguyên chữ khác', () => {
    const env = { DATABASE_URL: 'postgresql://u:pw-secret-77@db:5432/x', PANCAKE_API_KEY: 'pk-123456789', NODE_ENV: 'production', SHORT_TOKEN: 'abc' };
    const out = scrubSecrets({ a: 'key pk-123456789 và pw-secret-77', b: [{ c: 'production' }], n: 3 }, secretValues(env));
    expect(out).toEqual({ a: 'key *** và ***', b: [{ c: 'production' }], n: 3 });
  });
});
