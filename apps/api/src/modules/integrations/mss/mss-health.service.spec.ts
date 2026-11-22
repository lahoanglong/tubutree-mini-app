import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { readMssEnv, type MssEnv } from './mss-config';
import type { MssSharedStore } from './mss-circuit';
import { MSS_FLAG_KEYS, MSS_FLAGS, MssFlagsService } from './mss-flags';
import { MSS_CAPABILITY_WARN_MS, MSS_HEALTH_STALE_MS, MssHealthService } from './mss-health.service';
import { MssClient, type MssFetch } from './mss.client';

const FIXTURES = join(__dirname, '../../../../test/fixtures/mss');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const SECRETS = {
  MSS_OUTBOUND_SECRET: 'outbound-secret-not-for-prod-0123456789',
  MSS_INBOUND_SECRET: 'inbound-secret-not-for-prod-0123456789',
};
const fullEnv = (): MssEnv => readMssEnv({ NODE_ENV: 'test', MSS_BASE_URL: 'https://mss.example.test', MSS_KEY_ID: 'tubu-test', ...SECRETS });

class MemoryStore implements MssSharedStore {
  readonly data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
  async setIfAbsent(k: string, v: string) {
    if (this.data.has(k)) return false;
    this.data.set(k, v);
    return true;
  }
  async del(k: string) {
    this.data.delete(k);
  }
}

function setup(opts: { configs?: Record<string, unknown>; env?: MssEnv; health?: string; healthStatus?: number; store?: MssSharedStore } = {}) {
  const configs: Record<string, unknown> = { ...opts.configs };
  const config = { get: jest.fn(async (k: string, d: unknown) => (k in configs ? configs[k] : d)) } as unknown as SystemConfigService;
  let env = opts.env ?? fullEnv();
  const readEnv = () => env;
  const fetchImpl = jest.fn<ReturnType<MssFetch>, Parameters<MssFetch>>().mockImplementation(async () => new Response(opts.health ?? fixture('health.full.json'), { status: opts.healthStatus ?? 200 }));
  const flags = new MssFlagsService(config, readEnv);
  const client = new MssClient(readEnv, fetchImpl, opts.store);
  const prisma = { user: { findMany: jest.fn(async () => [{ id: 'admin-1' }]) } } as unknown as PrismaService;
  const notify = jest.fn(async () => undefined);
  const notifications = { notify } as unknown as NotificationsService;
  const svc = new MssHealthService(flags, client, prisma, notifications, opts.store);
  return { svc, fetchImpl, notify, configs, setEnv: (e: MssEnv) => (env = e) };
}

describe('MssHealthService', () => {
  let now: number;
  beforeEach(() => {
    now = Date.parse('2026-11-17T01:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    for (const level of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('mọi cờ tắt (mặc định PROD): không gọi MSS, không báo ai', () => {
    it('poll không gọi /health', async () => {
      const { svc, fetchImpl } = setup();
      await svc.poll();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each(MSS_FLAGS)('assertCapability(%s) = false, không gọi mạng, không thông báo', async (flag) => {
      const { svc, fetchImpl, notify } = setup();
      await expect(svc.assertCapability(flag)).resolves.toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('chuỗi "true" trong system_configs không phải là bật', async () => {
      const { svc, fetchImpl } = setup({ configs: { [MSS_FLAG_KEYS.orderPush]: 'true' } });
      await expect(svc.assertCapability('orderPush')).resolves.toBe(false);
      await svc.poll();
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  it('cờ bật nhưng thiếu biến môi trường: coi như tắt, không gọi MSS', async () => {
    const { svc, fetchImpl, notify } = setup({ configs: { [MSS_FLAG_KEYS.orderEvents]: true }, env: readMssEnv({}) });
    await svc.poll();
    await expect(svc.assertCapability('orderEvents')).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('cờ bật, đủ biến, MSS công bố năng lực: true; poll dò /health', async () => {
    const { svc, fetchImpl } = setup({ configs: { [MSS_FLAG_KEYS.orderEvents]: true } });
    await svc.poll();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://mss.example.test/api/ext/tubu/v1/health');
    await expect(svc.assertCapability('orderEvents')).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('cờ bật mà MSS chưa công bố năng lực (capabilities []): coi như tắt, báo Ops một lần mỗi giờ', async () => {
    const { svc, notify } = setup({ configs: { [MSS_FLAG_KEYS.orderEvents]: true }, health: fixture('health.ok.json') });
    await svc.poll();
    await expect(svc.assertCapability('orderEvents')).resolves.toBe(false);
    await expect(svc.assertCapability('orderEvents')).resolves.toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('admin-1', 'OPS_HEALTH_ALERT', expect.objectContaining({ title: 'Kết nối MSS', summary: expect.stringContaining('order_events') }));
    // Tin ngắn cho admin: "{{title}}: {{summary}}" ≤ 200 ký tự, chỉ tới thẻ MSS ở Sức khoẻ hệ thống, không có đường dẫn API.
    const { title, summary } = (notify.mock.calls[0] as unknown as [string, string, { title: string; summary: string }])[2];
    expect(`${title}: ${summary}`.length).toBeLessThanOrEqual(200);
    expect(summary).toMatch(/^\[Cảnh báo\] .* · Admin › Sức khoẻ hệ thống › MSS$/);
    expect(summary).not.toContain('/health');
    now += MSS_CAPABILITY_WARN_MS - 1;
    await svc.poll();
    await svc.assertCapability('orderEvents');
    expect(notify).toHaveBeenCalledTimes(1);
    now += 2;
    await svc.assertCapability('orderEvents');
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('báo một lần mỗi giờ dùng chung qua kho Redis giữa các replica', async () => {
    const store = new MemoryStore();
    const a = setup({ configs: { [MSS_FLAG_KEYS.invoice]: true }, health: fixture('health.ok.json'), store });
    const b = setup({ configs: { [MSS_FLAG_KEYS.invoice]: true }, health: fixture('health.ok.json'), store });
    await a.svc.assertCapability('invoice');
    await b.svc.assertCapability('invoice');
    expect(a.notify.mock.calls.length + b.notify.mock.calls.length).toBe(1);
  });

  it('MSS không trả lời (503 disabled): mọi cờ coi như tắt, lần dò ghi lỗi không kèm nội dung', async () => {
    const { svc, notify } = setup({ configs: { [MSS_FLAG_KEYS.customerSync]: true }, health: fixture('health.disabled.json'), healthStatus: 503 });
    await svc.poll();
    await expect(svc.assertCapability('customerSync')).resolves.toBe(false);
    const card = await svc.opsCard();
    expect(card.health).toMatchObject({ ok: false, error: 'unavailable', capabilities: [] });
    expect(JSON.stringify(card)).not.toContain('Kết nối Tubu đang tắt');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('kết quả dò quá 15 phút coi như chưa biết; hỏi lại theo nhu cầu tối đa mỗi phút', async () => {
    const { svc, fetchImpl } = setup({ configs: { [MSS_FLAG_KEYS.orderStatus]: true } });
    await svc.poll();
    now += MSS_HEALTH_STALE_MS + 1;
    await expect(svc.current()).resolves.toBeNull();
    await expect(svc.assertCapability('orderStatus')).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('các lần dò đồng thời dùng chung một lời gọi', async () => {
    const { svc, fetchImpl } = setup({ configs: { [MSS_FLAG_KEYS.orderStatus]: true } });
    await Promise.all([svc.refresh(), svc.refresh(), svc.refresh()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  describe('opsCard', () => {
    it('cờ tắt, thiếu biến: chỉ trạng thái có/thiếu, không giá trị, không gọi mạng', async () => {
      const { svc, fetchImpl } = setup({ env: readMssEnv({ MSS_BASE_URL: 'http://mss.example.test', MSS_OUTBOUND_SECRET: 'short' }) });
      const card = await svc.opsCard();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(card.configured).toBe(false);
      expect(card.polling).toBe(false);
      expect(card.env).toEqual({ MSS_BASE_URL: 'invalid', MSS_KEY_ID: 'missing', MSS_OUTBOUND_SECRET: 'invalid', MSS_INBOUND_SECRET: 'missing', MSS_INBOUND_SECRET_PREV: 'missing' });
      expect(card.flags).toHaveLength(MSS_FLAGS.length);
      expect(card.flags.every((f) => !f.enabled && !f.effective && f.capabilityPublished === null)).toBe(true);
      expect(card).toMatchObject({ orderEventsRolloutPct: 0, orderConsentPrechecked: false, catalogSource: 'pancake', health: null });
      expect(card.circuit.state).toBe('closed');
      expect(JSON.stringify(card)).not.toContain('mss.example.test');
    });

    it('đủ biến: không lộ giá trị bí mật hay URL', async () => {
      const { svc } = setup({ configs: { [MSS_FLAG_KEYS.orderEvents]: true } });
      await svc.poll();
      const text = JSON.stringify(await svc.opsCard());
      for (const v of [...Object.values(SECRETS), 'https://mss.example.test', 'tubu-test']) expect(text).not.toContain(v);
    });

    it('cờ bật + năng lực có: effective; cờ bật + năng lực thiếu: không effective', async () => {
      const { svc } = setup({ configs: { [MSS_FLAG_KEYS.orderEvents]: true, [MSS_FLAG_KEYS.catalogEnrichment]: true }, health: JSON.stringify({ ok: true, capabilities: ['order_events'] }) });
      await svc.poll();
      const card = await svc.opsCard();
      const byFlag = Object.fromEntries(card.flags.map((f) => [f.flag, f]));
      expect(byFlag.orderEvents).toMatchObject({ enabled: true, capabilityPublished: true, effective: true });
      expect(byFlag.catalogEnrichment).toMatchObject({ enabled: true, capabilityPublished: false, effective: false });
      expect(byFlag.invoice).toMatchObject({ enabled: false, capabilityPublished: false, effective: false });
      expect(card.polling).toBe(true);
    });

    it('rollout và nguồn danh mục đọc an toàn (giá trị lạ về mặc định)', async () => {
      const { svc } = setup({ configs: { 'mss.order_events_rollout_pct': 250, 'mss.catalog_source': 'shopify', 'mss.order_consent_prechecked': 'true' } });
      expect(await svc.opsCard()).toMatchObject({ orderEventsRolloutPct: 100, catalogSource: 'pancake', orderConsentPrechecked: false });
    });
  });
});
