import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SystemConfigService } from '../../system-config/system-config.service';
import { isMssConfigured, readMssEnv } from './mss-config';
import {
  clampRolloutPct,
  MSS_CATALOG_SOURCE_KEY,
  MSS_CONFIG_RANGES,
  MSS_FLAG_KEYS,
  MSS_JSON_RULES,
  MSS_ORDER_CONSENT_PRECHECKED_KEY,
  MSS_ORDER_EVENTS_ROLLOUT_PCT_KEY,
  parseCatalogSource,
} from './mss-flag-keys';

const S32 = 'x'.repeat(32);
const ALL_KEYS = [...Object.values(MSS_FLAG_KEYS), MSS_ORDER_EVENTS_ROLLOUT_PCT_KEY, MSS_ORDER_CONSENT_PRECHECKED_KEY, MSS_CATALOG_SOURCE_KEY];

describe('readMssEnv: thiếu biến thì tắt, API vẫn chạy', () => {
  it('không có biến nào: chưa cấu hình, mọi trạng thái missing', () => {
    const e = readMssEnv({});
    expect(isMssConfigured(e)).toBe(false);
    expect(e.status).toEqual({ MSS_BASE_URL: 'missing', MSS_KEY_ID: 'missing', MSS_OUTBOUND_SECRET: 'missing', MSS_INBOUND_SECRET: 'missing', MSS_INBOUND_SECRET_PREV: 'missing' });
  });

  it('đủ bốn biến bắt buộc: đã cấu hình; khoá trước là tuỳ chọn', () => {
    const e = readMssEnv({ MSS_BASE_URL: 'https://mss.example.test/', MSS_KEY_ID: 'tubu-1', MSS_OUTBOUND_SECRET: S32, MSS_INBOUND_SECRET: S32 });
    expect(isMssConfigured(e)).toBe(true);
    expect(e.baseUrl).toBe('https://mss.example.test');
    expect(e.status.MSS_INBOUND_SECRET_PREV).toBe('missing');
  });

  it.each(['MSS_BASE_URL', 'MSS_KEY_ID', 'MSS_OUTBOUND_SECRET', 'MSS_INBOUND_SECRET'])('thiếu %s: chưa cấu hình', (name) => {
    const full: Record<string, string> = { MSS_BASE_URL: 'https://mss.example.test', MSS_KEY_ID: 'tubu-1', MSS_OUTBOUND_SECRET: S32, MSS_INBOUND_SECRET: S32 };
    delete full[name];
    expect(isMssConfigured(readMssEnv(full))).toBe(false);
  });

  it('production chỉ nhận https; ngoài production cho http://localhost', () => {
    expect(readMssEnv({ NODE_ENV: 'production', MSS_BASE_URL: 'http://localhost:4000' }).status.MSS_BASE_URL).toBe('invalid');
    expect(readMssEnv({ NODE_ENV: 'development', MSS_BASE_URL: 'http://localhost:4000' }).baseUrl).toBe('http://localhost:4000');
    expect(readMssEnv({ NODE_ENV: 'development', MSS_BASE_URL: 'http://mss.example.test' }).status.MSS_BASE_URL).toBe('invalid');
  });

  it('URL có user:pass, query hay fragment bị từ chối; giữ đường dẫn con', () => {
    for (const u of ['https://u:p@mss.example.test', 'https://mss.example.test/?x=1', 'https://mss.example.test/#a', 'not a url', 'ftp://mss.example.test']) {
      expect(readMssEnv({ MSS_BASE_URL: u }).baseUrl).toBeNull();
    }
    expect(readMssEnv({ MSS_BASE_URL: 'https://erp.example.test/mss//' }).baseUrl).toBe('https://erp.example.test/mss');
  });

  it('bí mật ngắn hơn 32 ký tự và key id sai dạng: invalid, coi như thiếu', () => {
    const e = readMssEnv({ MSS_KEY_ID: 'a b', MSS_OUTBOUND_SECRET: 'x'.repeat(31), MSS_INBOUND_SECRET: '   ' });
    expect(e.status).toMatchObject({ MSS_KEY_ID: 'invalid', MSS_OUTBOUND_SECRET: 'invalid', MSS_INBOUND_SECRET: 'missing' });
    expect([e.keyId, e.outboundSecret, e.inboundSecret]).toEqual([null, null, null]);
  });
});

describe('khoá system_configs mss.*', () => {
  it('mọi khoá có luật ghi ở SystemConfigService (admin không lưu được giá trị sai dạng)', () => {
    for (const k of ALL_KEYS) expect(SystemConfigService.hasWriteRule(k)).toBe(true);
  });

  it('cờ chỉ nhận boolean thật: "true", 1, null bị từ chối', () => {
    for (const k of [...Object.values(MSS_FLAG_KEYS), MSS_ORDER_CONSENT_PRECHECKED_KEY]) {
      const rule = MSS_JSON_RULES[k]!;
      expect(rule(true)).toBeNull();
      expect(rule(false)).toBeNull();
      for (const bad of ['true', 'false', 1, 0, null, undefined, {}]) expect(rule(bad)).not.toBeNull();
    }
  });

  it('nguồn danh mục chỉ pancake hoặc mss', () => {
    const rule = MSS_JSON_RULES[MSS_CATALOG_SOURCE_KEY]!;
    expect(rule('pancake')).toBeNull();
    expect(rule('mss')).toBeNull();
    for (const bad of ['MSS', 'shopify', '', null, 1]) expect(rule(bad)).not.toBeNull();
  });

  it('rollout là số nguyên 0..100', () => {
    expect(MSS_CONFIG_RANGES[MSS_ORDER_EVENTS_ROLLOUT_PCT_KEY]).toMatchObject({ min: 0, max: 100, integer: true });
    expect([clampRolloutPct(-5), clampRolloutPct(37.9), clampRolloutPct('50'), clampRolloutPct(1e9), clampRolloutPct('x'), clampRolloutPct(null)]).toEqual([0, 37, 50, 100, 0, 0]);
    expect([parseCatalogSource('mss'), parseCatalogSource('pancake'), parseCatalogSource('MSS'), parseCatalogSource(undefined)]).toEqual(['mss', 'pancake', 'pancake', 'pancake']);
  });

  it('seed createOnly và migration INSERT gieo đủ 13 khoá với giá trị TẮT/an toàn', () => {
    const seed = readFileSync(join(__dirname, '../../../../prisma/seed.ts'), 'utf8');
    const migDir = join(__dirname, '../../../../prisma/migrations');
    const mig = readdirSync(migDir)
      .filter((d) => d.endsWith('_mss_foundation') || d.endsWith('_mss_stock_sync_flag') || d.endsWith('_w35_01_order_recipient_zalo') || d.endsWith('_w36_01_mss_cart_events'))
      .map((d) => readFileSync(join(migDir, d, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(mig).toContain('ON CONFLICT ("key") DO NOTHING');
    const expected: Record<string, string> = Object.fromEntries(ALL_KEYS.map((k) => [k, "'false'::jsonb"]));
    expected[MSS_ORDER_EVENTS_ROLLOUT_PCT_KEY] = "'0'::jsonb";
    expected[MSS_CATALOG_SOURCE_KEY] = `'"pancake"'::jsonb`;
    for (const [k, v] of Object.entries(expected)) {
      expect(mig).toContain(`('${k}', ${v},`);
      const row = seed.split('\n').find((l) => l.includes(`key: '${k}'`));
      expect(row).toBeDefined();
      expect(row).toContain('createOnly: true');
      expect(row).toContain(k === MSS_ORDER_EVENTS_ROLLOUT_PCT_KEY ? 'value: 0,' : k === MSS_CATALOG_SOURCE_KEY ? "value: 'pancake'," : 'value: false,');
    }
    expect(ALL_KEYS).toHaveLength(13);
  });
});
