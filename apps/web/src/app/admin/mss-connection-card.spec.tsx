// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MssConnectionCard, type MssOpsCard } from './mss-connection-card';
import { flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const mount = () => {
  const r = render(<MssConnectionCard />);
  mounted.push(r);
  return r;
};

const URL_PART = '/admin/ops/health';
const FLAGS = ['catalogEnrichment', 'orderEvents', 'customerSync', 'orderPush', 'orderStatus', 'invoice', 'catalogShadow', 'stockSync', 'orderRecipient', 'cartAbandonedZalo', 'orderBill'] as const;
const KEYS: Record<(typeof FLAGS)[number], string> = {
  catalogEnrichment: 'mss.catalog_enrichment_enabled',
  orderEvents: 'mss.order_events_enabled',
  customerSync: 'mss.customer_sync_enabled',
  orderPush: 'mss.order_push_enabled',
  orderStatus: 'mss.order_status_enabled',
  invoice: 'mss.invoice_enabled',
  catalogShadow: 'mss.catalog_shadow_enabled',
  stockSync: 'mss.stock_sync_enabled',
  orderRecipient: 'mss.order_recipient_enabled',
  cartAbandonedZalo: 'mss.cart_abandoned_zalo_enabled',
  orderBill: 'mss.order_bill_enabled',
};
const CAP: Record<(typeof FLAGS)[number], string> = {
  catalogEnrichment: 'catalog.enrichment',
  orderEvents: 'order_events',
  customerSync: 'customers',
  orderPush: 'orders',
  orderStatus: 'orders',
  invoice: 'invoice',
  catalogShadow: 'catalog.source',
  stockSync: 'catalog.source',
  orderRecipient: 'order_events.recipient_role',
  cartAbandonedZalo: 'cart.abandoned_zalo',
  orderBill: 'order_events.bill_v1',
};

const offCard = (): MssOpsCard => ({
  configured: false,
  env: { MSS_BASE_URL: 'missing', MSS_KEY_ID: 'missing', MSS_OUTBOUND_SECRET: 'missing', MSS_INBOUND_SECRET: 'missing', MSS_INBOUND_SECRET_PREV: 'missing' },
  flags: FLAGS.map((flag) => ({ flag, key: KEYS[flag], enabled: false, capability: CAP[flag], capabilityPublished: null, effective: false })),
  orderEventsRolloutPct: 0,
  orderConsentPrechecked: false,
  catalogSource: 'pancake',
  polling: false,
  health: null,
  circuit: { state: 'closed', consecutiveFailures: 0, openUntil: null, lastFailureAt: null, lastFailureKind: null, sharedStore: 'ok' },
});

const opsBody = (mss: unknown) => ({ generatedAt: '2026-11-17T01:00:00.000Z', problems: [], ...(mss === undefined ? {} : { mss }) });
const stub = (mss: unknown) => {
  const m = mockFetch({ [URL_PART]: { body: opsBody(mss) } });
  vi.stubGlobal('fetch', m.fn);
  return m;
};
const flagRows = (r: Rendered) => Array.from(r.container.querySelectorAll('ul[aria-label="Cờ MSS"] > li'));
const envRows = (r: Rendered) => Array.from(r.container.querySelectorAll('dl[aria-label="Biến môi trường MSS"] > div'));

describe('MssConnectionCard', () => {
  it('API cũ chưa có khoá mss: không vẽ gì (màn Sức khoẻ y như trước)', async () => {
    stub(undefined);
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toBe('');
  });

  it('mặc định PROD (thiếu biến, mọi cờ tắt): Chưa cấu hình, 4 biến Thiếu, khoá trước Không đặt, 11 cờ Tắt, cầu dao Đóng, không dò', async () => {
    const m = stub(offCard());
    const r = mount();
    await flush(10);
    expect(m.calls.filter((c) => c.url.includes(URL_PART))).toHaveLength(1);
    const text = r.container.textContent!;
    expect(text).toContain('Kết nối MSS');
    expect(text).toContain('Chưa cấu hình');
    expect(text).toContain('Thiếu biến môi trường nên mọi cờ MSS coi như tắt');
    expect(envRows(r).map((d) => d.textContent)).toEqual([
      'MSS_BASE_URLThiếu',
      'MSS_KEY_IDThiếu',
      'MSS_OUTBOUND_SECRETThiếu',
      'MSS_INBOUND_SECRETThiếu',
      'MSS_INBOUND_SECRET_PREVKhông đặt',
    ]);
    const rows = flagRows(r);
    expect(rows).toHaveLength(11);
    expect(rows[10]!.textContent).toContain('Ảnh hoá đơn + link xem đơn (tin Zalo)');
    expect(rows.every((li) => li.textContent!.includes('Tắt'))).toBe(true);
    expect(text).toContain('Không dò (không cờ nào bật)');
    expect(text).toContain('Đóng');
    expect(text).toContain('Tỉ lệ đơn gửi sự kiện tin Zalo: 0%');
    expect(text).toContain('Nguồn SKU, giá, tồn kho: Pancake');
  });

  it('đủ biến, cờ bật, MSS công bố một phần năng lực: hiện năng lực, cờ nào có hiệu lực, cờ nào thiếu năng lực', async () => {
    const card = offCard();
    card.configured = true;
    card.polling = true;
    card.env = { MSS_BASE_URL: 'ok', MSS_KEY_ID: 'ok', MSS_OUTBOUND_SECRET: 'ok', MSS_INBOUND_SECRET: 'ok', MSS_INBOUND_SECRET_PREV: 'missing' };
    card.health = { checkedAt: '2026-11-17T01:00:00.000Z', ok: true, capabilities: ['order_events'], contract: { order_events: '1.2', commerce: '0.9' }, error: null };
    card.flags = card.flags.map((f) =>
      f.flag === 'orderEvents' ? { ...f, enabled: true, capabilityPublished: true, effective: true } : f.flag === 'invoice' ? { ...f, enabled: true, capabilityPublished: false } : { ...f, capabilityPublished: false },
    );
    stub(card);
    const r = mount();
    await flush(10);
    const text = r.container.textContent!;
    expect(text).toContain('Đã cấu hình');
    expect(text).toContain('Tốt');
    expect(text).toContain('08:00 17/11/2026');
    expect(text).toContain('order_events 1.2, commerce 0.9');
    const byKey = Object.fromEntries(flagRows(r).map((li) => [FLAGS.find((f) => li.textContent!.includes(KEYS[f]))!, li.textContent!]));
    expect(byKey.orderEvents).toContain('Có hiệu lực');
    expect(byKey.invoice).toContain('MSS chưa có "invoice"');
    expect(byKey.orderPush).toContain('Tắt');
    expect(byKey.orderPush).not.toContain('hiệu lực');
  });

  it('dò hỏng và cầu dao ngắt: hiện loại lỗi, mốc ngắt, số lỗi liên tiếp, Redis không trả lời', async () => {
    const card = offCard();
    card.configured = true;
    card.polling = true;
    card.health = { checkedAt: '2026-11-17T01:00:00.000Z', ok: false, capabilities: [], contract: null, error: 'timeout' };
    card.circuit = { state: 'open', consecutiveFailures: 10, openUntil: '2026-11-17T01:05:00.000Z', lastFailureAt: '2026-11-17T01:00:00.000Z', lastFailureKind: 'timeout', sharedStore: 'unavailable' };
    stub(card);
    const r = mount();
    await flush(10);
    const text = r.container.textContent!;
    expect(text).toContain('Hỏng (timeout)');
    expect(text).toContain('Ngắt đến 08:05 17/11/2026');
    expect(text).toContain('10 lỗi liên tiếp (gần nhất: timeout)');
    expect(text).toContain('Redis không trả lời');
    expect(text).not.toContain('Năng lực MSS công bố');
  });

  it('cờ có hiệu lực mà cầu dao đang ngắt: nhãn cờ nói rõ cầu dao ngắt, không chỉ "Có hiệu lực"', async () => {
    const card = offCard();
    card.configured = true;
    card.polling = true;
    card.health = { checkedAt: '2026-11-17T01:00:00.000Z', ok: true, capabilities: ['order_events'], contract: null, error: null };
    card.flags = card.flags.map((f) => (f.flag === 'orderEvents' ? { ...f, enabled: true, capabilityPublished: true, effective: true } : f));
    card.circuit = { state: 'open', consecutiveFailures: 10, openUntil: '2026-11-17T01:05:00.000Z', lastFailureAt: '2026-11-17T01:00:00.000Z', lastFailureKind: 'timeout', sharedStore: 'ok' };
    stub(card);
    const r = mount();
    await flush(10);
    const row = [...r.container.querySelectorAll('ul[aria-label="Cờ MSS"] li')].find((li) => li.textContent!.includes('mss.order_events_enabled'))!;
    expect(row.textContent).toContain('Có hiệu lực, cầu dao ngắt');
  });

  it('máy chủ không đọc được trạng thái (mss: null): báo riêng, không làm hỏng thẻ', async () => {
    stub(null);
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toContain('Không đọc được trạng thái kết nối MSS');
  });

  it('khoá cờ dài không tràn ngang ở 360px: cột chữ min-w-0, khoá break-all', async () => {
    stub(offCard());
    const r = mount();
    await flush(10);
    const li = flagRows(r)[0]!;
    expect(li.querySelector('.min-w-0')).not.toBeNull();
    expect(li.querySelector('.break-all')!.textContent).toBe('mss.catalog_enrichment_enabled');
  });
});
