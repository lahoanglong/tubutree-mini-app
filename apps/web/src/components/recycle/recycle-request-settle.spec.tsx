// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteRequestDetailDTO } from '@tubutree/shared-types';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { makeRequestDetail, makeWarehouseContact, makeWasteMe, makeWastePoint } from './recycle-fixtures';

// Huỷ yêu cầu và lưu mã vận đơn giữ khoá tới khi dữ liệu làm mới về nhưng tối đa 4 giây (settleWithin): làm mới treo thì sheet huỷ vẫn đóng và nút
// "Đã gửi" vẫn nhả, thay vì kẹt vô hạn trên một lệnh đã xong.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  request: null as unknown,
  requestError: null as unknown,
  requestGate: null as null | Promise<unknown>,
  me: null as unknown,
  points: [] as unknown[],
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as Record<string, unknown>,
  support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null } as unknown,
  calls: [] as { method: string; path: string; body?: unknown }[],
  cancel: null as unknown as () => unknown,
  tracking: null as unknown as (b: unknown) => unknown,
  copied: [] as string[],
}));

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: replaceMock, push: vi.fn() }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('@/components/ui/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'GET', path });
      if (path === '/waste/requests/req-1') {
        await state.requestGate;
        if (state.requestError) throw state.requestError;
        return state.request;
      }
      if (path === '/waste/me') return state.me;
      if (path.startsWith('/waste/points')) return state.points;
      if (path === '/config/public') return { support: state.support };
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'POST', path, body });
      if (path === '/waste/requests/req-1/cancel') return state.cancel();
      throw new Error(`chưa mock ${path}`);
    },
    put: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'PUT', path, body });
      if (path === '/waste/requests/req-1/tracking') return state.tracking(body);
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import { RecycleRequestDetail } from './recycle-request';

const MAIL = (over: Partial<WasteRequestDetailDTO> = {}) =>
  makeRequestDetail({ method: 'MAIL_IN', pointName: 'Kho Tubu TP.HCM', point: makeWarehouseContact(), ...over });
const PICKUP = (over: Partial<WasteRequestDetailDTO> = {}) =>
  makeRequestDetail({ method: 'PICKUP', pointName: 'Kho Tubu TP.HCM', point: makeWarehouseContact(), ...over });
const PAUSED = 'Chương trình đang tạm dừng';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleRequestDetail id="req-1" />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const button = (c: ParentNode, name: string) => byText(c, 'button', name) as HTMLButtonElement | null;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const field = (c: ParentNode, label: string) => (byText(c, 'label', label) as HTMLLabelElement).control;
const calls = (method: string) => state.calls.filter((x) => x.method === method);

beforeEach(() => {
  state.phase = 'authenticated';
  state.request = makeRequestDetail();
  state.requestError = null;
  state.requestGate = null;
  state.me = makeWasteMe();
  state.points = [makeWastePoint()];
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.calls = [];
  state.copied = [];
  state.cancel = () => makeRequestDetail({ status: 'CANCELLED', cancellable: false, editable: false });
  state.tracking = () => MAIL({ status: 'IN_TRANSIT', carrier: 'GHN', trackingCode: 'GHN123' });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t: string) => void state.copied.push(t) },
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('/doi-rac/yeu-cau/[id]: làm mới sau ghi treo thì khoá nhả sau 4 giây', () => {
  it('huỷ: lời "Đã huỷ yêu cầu" hiện ngay, sheet còn mở ở 3,9 giây (chờ dữ liệu), đóng ở 4 giây dù làm mới chưa về', async () => {
    const c = await mount();
    click(button(c, 'Huỷ yêu cầu'));
    await flush(2);
    state.requestGate = new Promise(() => undefined);
    click(button(dialog()!, 'Xác nhận huỷ'));
    await flush(4);
    expect(c.textContent).toContain('Đã huỷ yêu cầu');
    expect(dialog()).not.toBeNull();
    await advance(3_900);
    expect(dialog()).not.toBeNull();
    await advance(200);
    await flush(3);
    expect(dialog()).toBeNull();
  });

  it('lưu mã vận đơn: nút giữ aria-busy tới 4 giây, lời "Đã lưu mã vận đơn" chỉ hiện khi hết chờ, dù làm mới chưa về', async () => {
    state.request = MAIL();
    const c = await mount();
    typeInto(field(c, 'Hãng'), 'GHN');
    typeInto(field(c, 'Mã vận đơn'), 'GHN123');
    state.requestGate = new Promise(() => undefined);
    const sent = button(c, 'Đã gửi')!;
    click(sent);
    await flush(4);
    expect(calls('PUT')).toHaveLength(1);
    expect(sent.getAttribute('aria-busy')).toBe('true');
    expect(c.textContent).not.toContain('Đã lưu mã vận đơn');
    await advance(3_900);
    expect(c.textContent).not.toContain('Đã lưu mã vận đơn');
    click(sent);
    await flush(2);
    expect(calls('PUT')).toHaveLength(1);
    await advance(200);
    await flush(3);
    expect(c.textContent).toContain('Đã lưu mã vận đơn');
    expect(sent.hasAttribute('aria-busy')).toBe(false);
  });
});
