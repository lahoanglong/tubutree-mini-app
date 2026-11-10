// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WastePreviewDTO } from '@tubutree/shared-types';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { saveReturn } from '@/lib/recycle-wizard';
import { makeRequestDetail, makeWasteMe, makeWastePoint } from './recycle-fixtures';

// Lưu thay đổi xong chờ dữ liệu làm mới về rồi mới chuyển trang, nhưng tối đa 4 giây (settleWithin): làm mới treo thì vẫn về trang yêu cầu.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  replace: vi.fn(),
  request: null as unknown,
  me: null as unknown,
  meFail: false,
  meGate: null as Promise<void> | null,
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as Record<string, unknown>,
  preview: null as unknown as (b: unknown) => unknown,
  edit: null as unknown as (b: unknown) => unknown,
  calls: [] as { method: string; path: string; body?: unknown }[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
  usePathname: () => '/doi-rac/yeu-cau/req-1/sua',
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('./recycle-labels', async (orig) => ({ ...(await orig<object>()), PREVIEW_DEBOUNCE_MS: 0 }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'GET', path });
      if (path === '/waste/requests/req-1') return state.request;
      if (path === '/waste/me') {
        if (state.meGate) await state.meGate;
        if (state.meFail) {
          state.meFail = false;
          throw new Error('Máy chủ bận');
        }
        return state.me;
      }
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'POST', path, body });
      if (path === '/waste/preview') return state.preview(body);
      throw new Error(`chưa mock ${path}`);
    },
    patch: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'PATCH', path, body });
      if (path === '/waste/requests/req-1') return state.edit(body);
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import { RecycleEdit } from './recycle-edit';

const preview = (over: Partial<WastePreviewDTO> = {}): WastePreviewDTO => ({
  estimatedPoints: 6000,
  estimatedDrops: 0,
  estimatedGrams: null,
  pointsValueVnd: 6000,
  blocks: [],
  feeEstimate: null,
  itemCaps: [],
  pointsMonthRemaining: 190_000,
  ...over,
});
const DETAIL = '/doi-rac/yeu-cau/req-1';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleEdit id="req-1" />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const card = (c: HTMLElement, name: string) => byText(c, '[data-item]', name)!;
const stepper = (c: HTMLElement, item: string, label: 'Tăng số lượng' | 'Giảm số lượng') =>
  card(c, item).querySelector<HTMLElement>(`button[aria-label^="${label}"]`)!;
const button = (c: ParentNode, name: string) => byText(c, 'button', name) as HTMLButtonElement | null;
const calls = (method: string) => state.calls.filter((x) => x.method === method);
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  window.sessionStorage.clear();
  state.phase = 'authenticated';
  state.replace = vi.fn();
  state.request = makeRequestDetail();
  state.me = makeWasteMe();
  state.meFail = false;
  state.meGate = null;
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.calls = [];
  state.preview = () => preview();
  state.edit = () => makeRequestDetail();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('/doi-rac/yeu-cau/[id]/sua: làm mới sau khi lưu treo', () => {
  it('lưu xong: giữ nút aria-busy tới 4 giây rồi mới về trang yêu cầu dù làm mới chưa về; bấm thêm không gửi PATCH thứ hai', async () => {
    saveReturn({ lines: { 'item-carton': 3 }, method: 'DROP_OFF', pointId: 'pt-2', pickedPoint: makeWastePoint({ id: 'pt-2', name: 'Đại lý Mới' }), provinceCode: null });
    const c = await mount();
    state.meGate = new Promise<void>(() => undefined);
    const save = button(c, 'Lưu thay đổi')!;
    click(save);
    await flush(4);
    expect(calls('PATCH')).toHaveLength(1);
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(state.replace).not.toHaveBeenCalledWith(DETAIL);
    await advance(3_900);
    expect(state.replace).not.toHaveBeenCalledWith(DETAIL);
    click(save);
    await flush(2);
    expect(calls('PATCH')).toHaveLength(1);
    await advance(200);
    await flush(3);
    expect(state.replace).toHaveBeenLastCalledWith(DETAIL);
    expect(calls('PATCH')).toHaveLength(1);
  });
});
