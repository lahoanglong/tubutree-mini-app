// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/client-api', () => ({ apiFetch: vi.fn() }));

import { BEACON_URL } from '@/lib/analytics';
import { parseRumConfig } from './rum-config';
import { __resetWebVitalsForTest, netType, startWebVitals, vitalEvent, type VitalMetric, type WebVitalsLib } from './web-vitals';
import { WebVitalsReporter } from './web-vitals-reporter';

type Cb = (m: VitalMetric) => void;
function fakeLib() {
  const cbs: Record<string, Cb> = {};
  const on = (name: string) => (cb: Cb) => {
    cbs[name] = cb;
  };
  const lib: WebVitalsLib = { onLCP: on('LCP'), onCLS: on('CLS'), onINP: on('INP'), onFCP: on('FCP'), onTTFB: on('TTFB') };
  return { lib, emit: (name: string, value: number, navigationType = 'navigate') => cbs[name]!({ name, value, navigationType }) };
}

const hide = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const beaconPayload = (call: unknown[]) => JSON.parse((call[1] as URLSearchParams).get('payload')!) as { events: Array<Record<string, unknown> & { props: Record<string, unknown> }> };

let sendBeacon: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetWebVitalsForTest();
  sendBeacon = vi.fn(() => true);
  fetchMock = vi.fn(async () => new Response(null));
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
  Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  window.history.replaceState(null, '', '/san-pham/nuoc-giat-cho-be-pineboo-2-1l-22a73c?utm_source=zalo');
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebVitalsReporter', () => {
  it('cờ tắt: không tải thư viện đo, không một request nào', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(<WebVitalsReporter enabled={false} samplePct={100} />));
    hide();
    await flush();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => root.unmount());
    // Lượt tải này chưa từng bắt đầu đo: bật lại sau đó vẫn đo được.
    const { lib } = fakeLib();
    const load = vi.fn(async () => lib);
    startWebVitals(100, { load });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

/**
 * Thư viện giống bản thật ở chỗ quan trọng: không có `reportAllChanges` thì LCP/CLS/INP chỉ được báo trong trình nghe ẩn trang của chính thư viện,
 * và trình nghe đó của CLS chỉ được gắn khi FCP xảy ra (sau khi bộ thu đã gắn trình nghe của nó).
 */
function realisticLib(): WebVitalsLib {
  const late = (name: string, value: number) => (cb: (m: VitalMetric) => void, opts?: { reportAllChanges?: boolean }) => {
    if (opts?.reportAllChanges) cb({ name, value });
    else if (name === 'CLS') setTimeout(() => document.addEventListener('visibilitychange', () => cb({ name, value }), true), 0);
    else document.addEventListener('visibilitychange', () => cb({ name, value }), true);
  };
  return {
    onFCP: (cb) => cb({ name: 'FCP', value: 800 }),
    onTTFB: (cb) => cb({ name: 'TTFB', value: 90 }),
    onLCP: late('LCP', 1900),
    onINP: late('INP', 220),
    onCLS: late('CLS', 0.04),
  };
}

describe('startWebVitals — thứ tự trình nghe như thư viện thật', () => {
  it('ẩn trang mà khách chưa bấm gì: gói vẫn có LCP, CLS và INP (không chỉ TTFB, FCP)', async () => {
    startWebVitals(100, { load: async () => realisticLib(), rand: () => 0 });
    await flush();
    await flush();
    hide();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const names = beaconPayload(sendBeacon.mock.calls[0]!).events.map((e) => e.props.name).sort();
    expect(names).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);
  });
});

describe('startWebVitals', () => {
  it('gửi đúng MỘT gói khi trang ẩn: mẫu route, nhóm khung nhìn, không mã khách, không URL thật', async () => {
    const { lib, emit } = fakeLib();
    startWebVitals(100, { load: async () => lib, rand: () => 0.5 });
    await flush();
    emit('TTFB', 120.4);
    emit('FCP', 900.6);
    emit('LCP', 2100.2);
    emit('LCP', 2600.7);
    emit('CLS', 0.123456);
    emit('INP', 180);
    hide();
    hide();
    window.dispatchEvent(new Event('pagehide'));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]![0]).toBe(BEACON_URL);
    const { events } = beaconPayload(sendBeacon.mock.calls[0]!);
    expect(events).toHaveLength(5);
    for (const e of events) {
      expect(e).toEqual(expect.objectContaining({ eventName: 'web_vital', platform: 'web' }));
      expect(e).not.toHaveProperty('anonymousId');
      expect(e).not.toHaveProperty('sessionId');
      expect(e.props).toEqual(expect.objectContaining({ route: '/san-pham/:slug', vp: 's', nav: 'navigate' }));
      expect(JSON.stringify(e)).not.toContain('pineboo');
      expect(JSON.stringify(e)).not.toContain('utm_source');
    }
    const byName = Object.fromEntries(events.map((e) => [e.props.name, e.props]));
    expect(byName.LCP).toEqual(expect.objectContaining({ value: 2601, rating: 'needs-improvement' }));
    expect(byName.CLS).toEqual(expect.objectContaining({ value: 0.1235, rating: 'needs-improvement' }));
    expect(byName.TTFB).toEqual(expect.objectContaining({ value: 120, rating: 'good' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('không được chọn mẫu thì không tải thư viện, không gửi', async () => {
    const load = vi.fn(async () => fakeLib().lib);
    startWebVitals(10, { load, rand: () => 0.5 });
    hide();
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('Do Not Track: không đo', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    const load = vi.fn(async () => fakeLib().lib);
    startWebVitals(100, { load });
    expect(load).not.toHaveBeenCalled();
  });

  it('chưa có số đo nào thì không gửi gói rỗng; sendBeacon từ chối thì lùi về fetch keepalive không kèm cookie', async () => {
    const { lib, emit } = fakeLib();
    startWebVitals(100, { load: async () => lib });
    await flush();
    hide();
    expect(sendBeacon).not.toHaveBeenCalled();
    __resetWebVitalsForTest();
    sendBeacon.mockReturnValue(false);
    const second = fakeLib();
    startWebVitals(100, { load: async () => second.lib });
    await flush();
    second.emit('FCP', 1000);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    hide();
    expect(fetchMock).toHaveBeenCalledWith(BEACON_URL, expect.objectContaining({ keepalive: true, credentials: 'omit' }));
    void emit;
  });

  it('chỉ gọi một lần mỗi lượt tải trang', async () => {
    const load = vi.fn(async () => fakeLib().lib);
    startWebVitals(100, { load });
    startWebVitals(100, { load });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('vitalEvent / netType / parseRumConfig', () => {
  it('làm tròn ms, CLS 4 số lẻ; navigationType lạ bị bỏ', () => {
    const e = vitalEvent({ name: 'INP', value: 499.6, navigationType: 'weird' }, { route: '/', vp: 'l', et: '4g' }, 'id', 'at');
    expect(e.props).toEqual({ name: 'INP', value: 500, rating: 'needs-improvement', route: '/', vp: 'l', et: '4g' });
  });

  it('loại mạng ngoài danh sách là unknown', () => {
    expect(netType({ connection: { effectiveType: '4g' } } as unknown as Navigator)).toBe('4g');
    expect(netType({ connection: { effectiveType: '5g' } } as unknown as Navigator)).toBe('unknown');
    expect(netType(undefined)).toBe('unknown');
  });

  it('cờ chỉ bật khi enabled true và tỉ lệ > 0', () => {
    expect(parseRumConfig({ perfRum: { enabled: true, samplePct: 100 } })).toEqual({ enabled: true, samplePct: 100 });
    expect(parseRumConfig({ perfRum: { enabled: true, samplePct: 0 } }).enabled).toBe(false);
    expect(parseRumConfig({ perfRum: { enabled: 'true', samplePct: 100 } }).enabled).toBe(false);
    expect(parseRumConfig({})).toEqual({ enabled: false, samplePct: 0 });
    expect(parseRumConfig(null).enabled).toBe(false);
  });
});
