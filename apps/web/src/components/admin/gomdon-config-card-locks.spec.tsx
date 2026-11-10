// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { GomdonConfigCard } from './gomdon-config-card';
import { GOMDON_CONFIG_KEY, GOMDON_TOGGLE_KEY } from '@/lib/admin-config-forms';
import type { ConfigRow } from '@/lib/admin-client';

// Wave 96B: admin "Thu kèm rác qua Gomdon (kỹ thuật)": công tắc kỹ thuật, Lưu kho & cân nặng, Kiểm tra kết nối. Một lệnh mỗi lúc, giữ khoá tới khi tình trạng làm mới
// về (tối đa 4 giây), nút giữ focus dùng aria-busy/aria-disabled thay disabled.

const ROWS: ConfigRow[] = [
  { key: GOMDON_TOGGLE_KEY, value: false, description: null, category: 'shipping' },
  { key: GOMDON_CONFIG_KEY, value: { defaultWarehouse: { name: 'Kho Tubu', phone: '0900000000', address: '1 Lê Lợi', ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM' }, defaultWeightFallback: 500 }, description: null, category: 'shipping' },
];
const STATUS = { baseUrlSet: true, credentialsSet: true, webhookSecretSet: true, recyclingEnabled: true, pickupVisible: true, connection: null };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

type Route = () => Promise<Response> | Response;
let calls: { method: string; url: string; body?: string }[] = [];
let routes: Record<string, Route> = {};
let mounted: Rendered | null = null;

beforeEach(() => {
  calls = [];
  routes = {
    'GET /admin/gomdon/status': () => json(200, STATUS),
    'PUT /admin/config': () => json(200, { ok: true }),
    'POST /admin/gomdon/check-connection': () => json(200, { ok: true, message: 'Đăng nhập được.', checkedAt: '2026-11-10T03:00:00.000Z' }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = new URL(url, 'http://x').pathname.replace(/^.*?\/admin\//, '/admin/');
      calls.push({ method, url: path, body: init?.body as string | undefined });
      const route = routes[`${method} ${path}`];
      if (!route) return json(500, { message: `no mock for ${method} ${path}` });
      return route();
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const count = (method: string, path: string) => calls.filter((c) => c.method === method && c.url === path).length;
const buttons = (root: ParentNode, text: string | RegExp) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')));
const btn = (root: ParentNode, text: string | RegExp) => buttons(root, text)[0]!;
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const aria = (b: HTMLElement) => ({ busy: b.getAttribute('aria-busy'), disabled: b.getAttribute('aria-disabled'), dom: (b as HTMLInputElement | HTMLButtonElement).disabled });
const toggleEl = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[role="switch"]')!;

async function mount() {
  mounted = render(<GomdonConfigCard rows={ROWS} />);
  await flush();
  return mounted.container;
}
const holdStatus = (g: { promise: Promise<unknown> }) => {
  let loads = 0;
  routes['GET /admin/gomdon/status'] = async () => {
    if (++loads > 1) await g.promise;
    return json(200, STATUS);
  };
};

describe('Công tắc kỹ thuật Gomdon', () => {
  it('chạm đúp cùng một khung hình chỉ ghi một lần; công tắc aria-busy/aria-disabled, không disabled (giữ focus)', async () => {
    const g = gate();
    routes['PUT /admin/config'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mount();
    const sw = toggleEl(c);
    sw.focus();
    await tap(sw, sw);
    await flush(1);
    expect(count('PUT', '/admin/config')).toBe(1);
    expect(JSON.parse(calls.find((x) => x.method === 'PUT')!.body!)).toEqual({ key: GOMDON_TOGGLE_KEY, value: true });
    expect(aria(toggleEl(c))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(toggleEl(c));
    g.resolve();
    await flush();
  });

  it('giữ khoá tới khi tình trạng làm mới về, hạn 4 giây', async () => {
    useHangTimers();
    holdStatus({ promise: new Promise(() => {}) });
    const c = await mount();
    await tap(toggleEl(c));
    await flush();
    await advance(3_500);
    expect(aria(toggleEl(c)).busy).toBe('true');
    await tap(toggleEl(c));
    expect(count('PUT', '/admin/config')).toBe(1);
    await advance(700);
    expect(aria(toggleEl(c)).busy).toBeNull();
  });

  it('lỗi 500: báo lỗi, không tải lại tình trạng, nhả khoá', async () => {
    routes['PUT /admin/config'] = () => json(500, { statusCode: 500, message: 'Lỗi máy chủ.' });
    const c = await mount();
    const before = count('GET', '/admin/gomdon/status');
    await tap(toggleEl(c));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(count('GET', '/admin/gomdon/status')).toBe(before);
    expect(aria(toggleEl(c)).busy).toBeNull();
  });
});

describe('Lưu kho & cân nặng', () => {
  it('gửi form hai lần cùng khung hình chỉ ghi một lần; nút aria-busy/aria-disabled, không disabled', async () => {
    const g = gate();
    routes['PUT /admin/config'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mount();
    const save = btn(c, 'Lưu kho & cân nặng');
    save.focus();
    await tap(save, save);
    await flush(1);
    expect(count('PUT', '/admin/config')).toBe(1);
    expect(aria(btn(c, 'Đang lưu…'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(btn(c, 'Đang lưu…'));
    g.resolve();
    await flush();
  });

  it('giữ khoá tới khi tình trạng làm mới về', async () => {
    const g = gate();
    holdStatus(g);
    const c = await mount();
    await tap(btn(c, 'Lưu kho & cân nặng'));
    await flush();
    expect(count('PUT', '/admin/config')).toBe(1);
    expect(aria(btn(c, /Đang lưu…|Lưu kho/)).disabled).toBe('true');
    await tap(btn(c, /Đang lưu…|Lưu kho/));
    expect(count('PUT', '/admin/config')).toBe(1);
    g.resolve();
    await flush();
    expect(aria(btn(c, 'Lưu kho & cân nặng')).disabled).toBeNull();
  });
});

describe('Kiểm tra kết nối', () => {
  it('chạm đúp chỉ đăng nhập Gomdon một lần; nút aria-busy/aria-disabled, không disabled', async () => {
    const g = gate();
    routes['POST /admin/gomdon/check-connection'] = async () => {
      await g.promise;
      return json(200, { ok: true, message: 'Đăng nhập được.', checkedAt: '2026-11-10T03:00:00.000Z' });
    };
    const c = await mount();
    const check = btn(c, 'Kiểm tra kết nối');
    check.focus();
    await tap(check, check);
    await flush(1);
    expect(count('POST', '/admin/gomdon/check-connection')).toBe(1);
    expect(aria(btn(c, 'Đang kiểm tra…'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(btn(c, 'Đang kiểm tra…'));
    g.resolve();
    await flush();
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đăng nhập được.');
  });

  it('giữ khoá tới khi tình trạng làm mới về: bấm lại trong lúc chờ không đăng nhập Gomdon lần nữa', async () => {
    const g = gate();
    holdStatus(g);
    const c = await mount();
    await tap(btn(c, 'Kiểm tra kết nối'));
    await flush();
    expect(count('POST', '/admin/gomdon/check-connection')).toBe(1);
    expect(count('GET', '/admin/gomdon/status')).toBe(2);
    expect(aria(btn(c, /Đang kiểm tra…|Kiểm tra kết nối/)).disabled).toBe('true');
    await tap(btn(c, /Đang kiểm tra…|Kiểm tra kết nối/));
    expect(count('POST', '/admin/gomdon/check-connection')).toBe(1);
    g.resolve();
    await flush();
    expect(aria(btn(c, 'Kiểm tra kết nối')).disabled).toBeNull();
  });
});
