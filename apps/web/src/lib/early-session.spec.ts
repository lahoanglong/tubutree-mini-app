// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@tubutree/app-core/http';
import { getArcadeStatus, getGameProfile, getMissions, getTodayQuiz } from '@tubutree/app-core/api/game';
import { getCoupons, getDailyCheckInStatus, getLoyalty } from '@tubutree/app-core/api/loyalty';
import { getMeSummary } from '@tubutree/app-core/api/me-summary';
import { getDailyMissions } from '@tubutree/app-core/engagement/api';
import { getMiniToday } from '@tubutree/app-core/game-mini/today';
import { EARLY_GETS, EARLY_SESSION_GLOBAL, earlySessionScript, type EarlySession } from './early-session';

vi.mock('./client-api', () => ({ apiFetch: vi.fn(async () => ({ items: [] })) }));

type FetchInit = { method: string; credentials: string; headers: Record<string, string>; body?: string; signal?: AbortSignal };
type Res = { status: number; ok: boolean; text: () => Promise<string> };
const res = (status: number, body = ''): Res => ({ status, ok: status >= 200 && status < 300, text: async () => body });

/** Chạy script như trình duyệt (các biến toàn cục truyền vào), trả biến script để lại và các lượt fetch. */
function run(opts: { marker?: string | null; refresh: () => Promise<Res>; get?: (url: string) => Promise<Res>; locks?: boolean; storageThrows?: boolean }) {
  const calls: { url: string; init: FetchInit }[] = [];
  const lockNames: string[] = [];
  const win: Record<string, unknown> = {};
  const fetch = vi.fn((url: string, init: FetchInit) => {
    calls.push({ url, init });
    return url.endsWith('/auth/refresh') ? opts.refresh() : (opts.get ?? (async () => res(200, '{"ok":true}')))(url);
  });
  const localStorage = {
    getItem: (k: string) => {
      if (opts.storageThrows) throw new Error('blocked');
      expect(k).toBe('tubu_web_session');
      return opts.marker === undefined ? '1' : opts.marker;
    },
  };
  const navigator = opts.locks
    ? {
        locks: {
          request: (name: string, fn: () => Promise<unknown>) => {
            lockNames.push(name);
            return fn();
          },
        },
      }
    : {};
  new Function('fetch', 'localStorage', 'navigator', 'window', earlySessionScript('https://api.example.test/api/', ['/cart', '/game/profile']))(
    fetch,
    localStorage,
    navigator,
    win,
  );
  return { early: win[EARLY_SESSION_GLOBAL] as EarlySession | undefined, calls, lockNames };
}

const okRefresh = () => Promise.resolve(res(200, JSON.stringify({ accessToken: 'tok-1', user: { id: 'u1' } })));
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('earlySessionScript (tubu-w8-01): refresh + GET đầu trang chạy từ lúc đọc HTML', () => {
  afterEach(() => vi.useRealTimers());

  it('không có cờ phiên (hay storage bị chặn) thì không gọi gì, không để lại biến', () => {
    for (const o of [{ marker: null }, { marker: '0' }, { storageThrows: true }]) {
      const r = run({ ...o, refresh: okRefresh });
      expect(r.calls).toEqual([]);
      expect(r.early).toBeUndefined();
    }
  });

  it('có cờ: refresh bằng cookie như client-api (POST, credentials include, x-client: web), rồi GET từng đường dẫn bằng access token mới', async () => {
    const r = run({ refresh: okRefresh, get: async (url) => res(200, JSON.stringify({ url })) });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe('https://api.example.test/api/auth/refresh');
    expect(r.calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'include', body: '{}', headers: { 'Content-Type': 'application/json', 'x-client': 'web' } });
    await settle();
    const gets = r.calls.slice(1);
    expect(gets.map((c) => c.url)).toEqual(['https://api.example.test/api/cart', 'https://api.example.test/api/game/profile']);
    for (const c of gets) {
      expect(c.init).toMatchObject({ method: 'GET', credentials: 'include', headers: { Authorization: 'Bearer tok-1', 'X-Client-Platform': 'web' } });
    }
    await expect(r.early!.take('/cart', 'tok-1')).resolves.toEqual({ status: 200, ok: true, body: { url: 'https://api.example.test/api/cart' } });
  });

  it('claim: lượt refresh nhận đúng một lần', async () => {
    const r = run({ refresh: okRefresh });
    await expect(r.early!.claim()).resolves.toEqual({ status: 200, ok: true, body: { accessToken: 'tok-1', user: { id: 'u1' } } });
    expect(r.early!.claim()).toBeNull();
  });

  it('take: một lần mỗi đường dẫn, chỉ cho đúng token của lượt refresh sớm (token khác không làm mất phản hồi)', async () => {
    const r = run({ refresh: okRefresh });
    await settle();
    expect(r.early!.take('/cart', 'tok-other')).toBeNull();
    expect(r.early!.take('/khong-co', 'tok-1')).toBeNull();
    await expect(r.early!.take('/cart', 'tok-1')).resolves.toMatchObject({ status: 200 });
    expect(r.early!.take('/cart', 'tok-1')).toBeNull();
  });

  it('quá hạn: claim sau 60 giây và take sau 30 giây đều null', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const r = run({ refresh: okRefresh });
    await settle();
    vi.setSystemTime(Date.now() + 30_001);
    expect(r.early!.take('/cart', 'tok-1')).toBeNull();
    vi.setSystemTime(Date.now() + 30_000);
    expect(r.early!.claim()).toBeNull();
  });

  it('refresh đi qua khoá Web Locks tubu_web_refresh (cùng khoá với client-api) khi trình duyệt có', async () => {
    const r = run({ refresh: okRefresh, locks: true });
    await r.early!.claim();
    expect(r.lockNames).toEqual(['tubu_web_refresh']);
  });

  it('refresh không ra token (401, 429, 5xx, thân thiếu token): không gọi GET nào, take null', async () => {
    for (const reply of [res(401, '{"message":"x"}'), res(429), res(503, 'oops'), res(200, '{"user":{}}')]) {
      const r = run({ refresh: async () => reply });
      await settle();
      expect(r.calls).toHaveLength(1);
      expect(r.early!.take('/cart', 'tok-1')).toBeNull();
    }
  });

  it('refresh lỗi giữ nguyên mã và thân để client-api xử lý như lượt refresh thường; thân lỗi không phải JSON thành null', async () => {
    await expect(run({ refresh: async () => res(401, '{"message":"het han"}') }).early!.claim()).resolves.toEqual({ status: 401, ok: false, body: { message: 'het han' } });
    await expect(run({ refresh: async () => res(502, '<html>') }).early!.claim()).resolves.toEqual({ status: 502, ok: false, body: null });
  });

  it('mất mạng ở refresh: claim bị từ chối (client-api coi là lỗi tạm), không GET, không lỗi chưa bắt', async () => {
    const r = run({ refresh: () => Promise.reject(new TypeError('Failed to fetch')) });
    await settle();
    expect(r.calls).toHaveLength(1);
    expect(r.early!.take('/cart', 'tok-1')).toBeNull();
    await expect(r.early!.claim()).rejects.toThrow('Failed to fetch');
  });

  it('GET trả 204 hay thân rỗng thì body null; 2xx mà thân hỏng hay mất mạng thì take ra null (client-api gọi lại)', async () => {
    const empty = run({ refresh: okRefresh, get: async (url) => (url.endsWith('/cart') ? res(204) : res(200, '')) });
    await settle();
    await expect(empty.early!.take('/cart', 'tok-1')).resolves.toEqual({ status: 204, ok: true, body: null });
    await expect(empty.early!.take('/game/profile', 'tok-1')).resolves.toEqual({ status: 200, ok: true, body: null });
    const broken = run({ refresh: okRefresh, get: async (url) => (url.endsWith('/cart') ? res(200, '{oops') : Promise.reject(new TypeError('x'))) });
    await settle();
    await expect(broken.early!.take('/cart', 'tok-1')).resolves.toBeNull();
    await expect(broken.early!.take('/game/profile', 'tok-1')).resolves.toBeNull();
  });

  it('mỗi lượt gọi có hạn chờ 20 giây (AbortController), như REQUEST_TIMEOUT_MS', () => {
    vi.useFakeTimers();
    const r = run({ refresh: () => new Promise<Res>(() => undefined) });
    const signal = r.calls[0]!.init.signal;
    vi.advanceTimersByTime(19_999);
    expect(signal?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal?.aborted).toBe(true);
  });

  it('chuỗi nhúng không đóng được thẻ script', () => {
    const s = earlySessionScript('https://x.test/</script><script>alert(1)</script>', ['/a</script>']);
    expect(s).not.toContain('</');
  });
});

describe('EARLY_GETS khớp đúng đường dẫn các trang gọi (lệch thì phản hồi mồi bị bỏ, trang chậm lại như cũ)', () => {
  /** Đường dẫn mỗi hàm gọi API dùng, ghi qua một HttpClient giả. */
  async function pathsOf(calls: ((http: HttpClient) => Promise<unknown>)[]): Promise<string[]> {
    const seen: string[] = [];
    const http = {
      get: async (path: string, opts?: { query?: unknown }) => {
        expect(opts?.query).toBeUndefined();
        seen.push(path);
        return {};
      },
    } as unknown as HttpClient;
    for (const call of calls) await call(http).catch(() => undefined);
    return seen;
  }

  it('Vườn Xanh: hồ sơ, câu đố, nhiệm vụ, Điểm Xanh, điểm danh, game mini, arcade, nhiệm vụ ngày, tóm tắt, mã, giỏ', async () => {
    const { getCart } = await import('./shop-client');
    const { apiFetch } = await import('./client-api');
    const fromCore = await pathsOf([getGameProfile, getTodayQuiz, getMissions, getLoyalty, getDailyCheckInStatus, getMiniToday, getArcadeStatus, getDailyMissions, getMeSummary, getCoupons]);
    await getCart();
    expect([...fromCore, vi.mocked(apiFetch).mock.calls.at(-1)?.[0]]).toEqual([...EARLY_GETS.garden]);
  });

  it('Giỏ: giỏ (không có gian hàng CTV ghi công) và mã của tôi', async () => {
    const { getCart, getMyCoupons } = await import('./shop-client');
    const { apiFetch } = await import('./client-api');
    vi.mocked(apiFetch).mockClear();
    await getCart();
    await getMyCoupons();
    expect(vi.mocked(apiFetch).mock.calls.map((c) => c[0])).toEqual([...EARLY_GETS.cart]);
  });
});
