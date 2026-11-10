// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WastePreviewDTO, WastePreviewRequest } from '@tubutree/shared-types';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { makeRewardCatalog } from '@/components/loyalty/reward-fixtures';
import { EMPTY_DRAFT, markResume, saveDraft, type WasteWizardDraft } from '@/lib/recycle-wizard';
import { makeRequestDetail, makeWasteMe, makeWastePoint } from './recycle-fixtures';

// Tạo yêu cầu xong chờ dữ liệu làm mới về rồi mới chuyển sang trang yêu cầu, nhưng tối đa 4 giây (settleWithin): làm mới treo thì vẫn chuyển trang.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
  me: null as unknown,
  points: [] as unknown[],
  rewards: null as unknown,
  preview: null as unknown as (b: unknown) => unknown,
  provinces: [] as unknown[],
  failProvinces: false,
  rules: { text: 'Thể lệ' } as { text: string; version?: string },
  rulesGate: null as Promise<void> | null,
  meGate: null as Promise<void> | null,
  create: null as unknown as (b: unknown, key: string) => unknown,
  calls: [] as { path: string; body?: unknown; headers?: Record<string, string> }[],
  keySeq: 0,
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => '/doi-rac/tao',
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => `key-${++state.keySeq}` }));
vi.mock('./recycle-labels', async (orig) => ({ ...(await orig<object>()), PREVIEW_DEBOUNCE_MS: 0 }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ path });
      if (path === '/waste/me') {
        if (state.meGate) await state.meGate;
        return state.me;
      }
      if (path.startsWith('/waste/points')) return state.points;
      if (path === '/me/loyalty/rewards') return state.rewards;
      if (path === '/waste/rules') {
        if (state.rulesGate) await state.rulesGate;
        return state.rules;
      }
      if (path === '/geo/provinces') {
        if (state.failProvinces) throw new Error('offline');
        return state.provinces;
      }
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body: unknown, opts?: { headers?: Record<string, string> }) => {
      state.calls.push({ path, body, headers: opts?.headers });
      if (path === '/waste/preview') return state.preview(body);
      if (path === '/waste/requests') return state.create(body, opts?.headers?.['Idempotency-Key'] ?? '');
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import { RecycleNew } from './recycle-new';

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
const FEE = { zoneName: 'Miền Bắc', provinceCode: '01', provinceName: 'Hà Nội', low: 30000, high: 45000 };
const DRAFT: WasteWizardDraft = { ...EMPTY_DRAFT, lines: { 'item-carton': 5, 'item-milk': 5 } };
const PICKED: WasteWizardDraft = { ...DRAFT, method: 'DROP_OFF', pointId: 'pt-1', pickedPoint: makeWastePoint() };
const atStep2 = (draft: WasteWizardDraft = DRAFT) => {
  state.search = 'step=method';
  saveDraft(draft);
  markResume();
};
const CONSENT = 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleNew />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!;
const barButton = (c: HTMLElement, name: string) => byText(bar(c), 'button', name) as HTMLButtonElement;
const card = (c: HTMLElement, name: string) => byText(c, '[data-item]', name)!;
const qtyOf = (c: HTMLElement, item: string) => card(c, item).querySelector<HTMLInputElement>('input[aria-label^="Số lượng"]')?.value;
const stepper = (c: HTMLElement, item: string, label: 'Tăng số lượng' | 'Giảm số lượng') =>
  card(c, item).querySelector<HTMLElement>(`button[aria-label^="${label}"]`)!;
const methods = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="radio"]')).map((r) => r.getAttribute('data-method'));
const method = (c: HTMLElement, m: string) => c.querySelector<HTMLElement>(`[data-method="${m}"]`)!;
const check = (c: HTMLElement, text: string) => byText(c, 'label', text)!.querySelector<HTMLInputElement>('input')!;
const previewCalls = () => state.calls.filter((x) => x.path === '/waste/preview').map((x) => x.body as WastePreviewRequest);
const createCalls = () => state.calls.filter((x) => x.path === '/waste/requests');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  window.sessionStorage.clear();
  state.phase = 'authenticated';
  state.search = '';
  state.push = vi.fn();
  state.replace = vi.fn();
  state.calls = [];
  state.failProvinces = false;
  state.rules = { text: 'Thể lệ' };
  state.rulesGate = null;
  state.meGate = null;
  state.keySeq = 0;
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.me = makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true } });
  state.points = [makeWastePoint()];
  state.rewards = makeRewardCatalog({ redeemablePoints: 14_000 });
  state.provinces = [
    { code: '01', name: 'Hà Nội' },
    { code: '79', name: 'TP.HCM' },
  ];
  state.preview = (b) => {
    const req = b as WastePreviewRequest;
    return preview(
      req.method === 'MAIL_IN'
        ? { feeEstimate: { ...FEE, provinceCode: '79', provinceName: 'TP.HCM', low: 20000, high: 25000 }, estimatedPoints: 30_000, pointsValueVnd: 30000 }
        : {},
    );
  };
  state.create = () => makeRequestDetail({ id: 'req-9' });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('tạo yêu cầu: làm mới sau khi tạo treo', () => {
  it('tạo xong: chờ dữ liệu về tối đa 4 giây rồi mới chuyển trang, nút giữ khoá; bấm thêm không tạo yêu cầu thứ hai', async () => {
    atStep2(PICKED);
    const c = await mount();
    click(check(c, CONSENT));
    await flush(3);
    state.meGate = new Promise<void>(() => undefined);
    const btn = barButton(c, 'Tạo yêu cầu');
    click(btn);
    await flush(4);
    expect(createCalls()).toHaveLength(1);
    expect(state.replace).not.toHaveBeenCalledWith('/doi-rac/yeu-cau/req-9');
    await advance(3_900);
    expect(state.replace).not.toHaveBeenCalledWith('/doi-rac/yeu-cau/req-9');
    click(btn);
    await flush(2);
    expect(createCalls()).toHaveLength(1);
    await advance(200);
    await flush(3);
    expect(state.replace).toHaveBeenLastCalledWith('/doi-rac/yeu-cau/req-9');
    expect(createCalls()).toHaveLength(1);
  });
});
