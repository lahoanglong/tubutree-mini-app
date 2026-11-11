// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Wave 101B: tấm sàn hoàn tiền đóng được lúc lệnh "Mua sắm" còn bay. Lệnh xong muộn của lần mở trước không được đóng tấm của sàn vừa mở lại
// hay đặt lời lỗi/liên kết của sàn cũ vào tấm mới; tab đối tác đã mở cho sàn cũ vẫn được đưa tới trang sàn đó.

const state = vi.hoisted(() => ({
  click: null as null | (() => Promise<unknown>),
  opened: [] as string[],
  win: null as null | { opener: unknown; closed?: boolean; location: { replace: (u: string) => void }; close: () => void },
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path === '/cashback/merchants') return MERCHANTS;
      if (path === '/cashback/transactions') return [];
      if (path === '/me/wallet') return { cashbackPending: 0 };
      if (path === '/config/public') return { cashbackHoldDays: 45 };
      throw new Error(`chưa mock ${path}`);
    },
    post: async () => state.click!(),
  },
}));

import CashbackPage from './page';

const MERCHANTS = [
  { id: 'm1', slug: 'shopee', name: 'Shopee', logoUrl: '', category: 'mall', baseRate: '0.05', terms: null },
  { id: 'm2', slug: 'lazada', name: 'Lazada', logoUrl: '', category: 'mall', baseRate: '0.035', terms: null },
];

let mounted: Rendered | null = null;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const tile = (name: string) => byText(document.body, 'button[data-merchant]', name)!;
const buyBtn = () => byText(dialog()!, 'button', 'Mua sắm & nhận hoàn tiền')!;
const closeByBackdrop = () => click(document.querySelector('[data-sheet-backdrop]'));
const gate = () => {
  let release!: (v: unknown) => void;
  let fail!: (e: unknown) => void;
  const p = new Promise((res, rej) => {
    release = res;
    fail = rej;
  });
  state.click = () => p;
  return { release, fail };
};

beforeEach(() => {
  state.opened = [];
  state.win = { opener: 'x', location: { replace: (u: string) => void state.opened.push(u) }, close: vi.fn() };
  vi.spyOn(window, 'open').mockImplementation((() => state.win) as typeof window.open);
});
afterEach(() => {
  vi.restoreAllMocks();
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

async function sentThenReopened(merchant: 'Shopee' | 'Lazada', blocked = false) {
  mounted = render(<CashbackPage />);
  await flush(8);
  if (blocked) state.win = null;
  const g = gate();
  click(tile('Shopee'));
  click(buyBtn());
  await flush();
  closeByBackdrop();
  click(tile(merchant));
  await flush(2);
  return g;
}

describe.each([
  ['sàn khác', 'Lazada' as const],
  ['cùng sàn', 'Shopee' as const],
])('/hoan-tien: đóng tấm rồi mở lại %s lúc lệnh còn bay', (_name, again) => {
  it('lệnh cũ xong muộn: tab đối tác vẫn tới trang của sàn cũ, tấm mới KHÔNG bị đóng', async () => {
    const g = await sentThenReopened(again);
    await act(async () => g.release({ deeplink: 'https://aff.example/shopee' }));
    await flush(4);
    expect(state.opened).toEqual(['https://aff.example/shopee']);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain(again);
  });

  it('liên kết sàn cũ không hợp lệ: lời lỗi không rơi vào tấm mới, tab trống vẫn được đóng', async () => {
    const g = await sentThenReopened(again);
    await act(async () => g.release({ deeplink: 'javascript:alert(1)' }));
    await flush(4);
    expect(state.win!.close).toHaveBeenCalled();
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
  });

  it('lệnh cũ bị từ chối: tab trống vẫn được đóng, lời lỗi không rơi vào tấm mới', async () => {
    const g = await sentThenReopened(again);
    await act(async () => g.fail(new Error('Sàn đã ngừng')));
    await flush(4);
    expect(state.win!.close).toHaveBeenCalled();
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
  });

  it('tab trống bị chặn: liên kết của sàn cũ không hiện trong tấm mới', async () => {
    const g = await sentThenReopened(again, true);
    await act(async () => g.release({ deeplink: 'https://aff.example/shopee' }));
    await flush(4);
    expect(dialog()!.textContent).not.toContain('Trình duyệt đã chặn cửa sổ mới');
  });
});

describe('/hoan-tien: lần mở không bị đóng đi mở lại vẫn chạy như trước', () => {
  const open = async () => {
    mounted = render(<CashbackPage />);
    await flush(8);
    const g = gate();
    click(tile('Shopee'));
    click(buyBtn());
    await flush();
    return g;
  };

  it('đúng lần mở đã gửi: tab tới sàn, tấm đóng, báo chuyển hướng', async () => {
    const g = await open();
    await act(async () => g.release({ deeplink: 'https://aff.example/shopee' }));
    await flush(4);
    expect(state.opened).toEqual(['https://aff.example/shopee']);
    expect(dialog()).toBeNull();
    expect(document.body.textContent).toContain('Đang chuyển');
  });

  it('khách đóng tấm và không mở lại: lệnh xong vẫn đưa tab tới sàn, báo chuyển hướng, tấm vẫn đóng', async () => {
    const g = await open();
    closeByBackdrop();
    await act(async () => g.release({ deeplink: 'https://aff.example/shopee' }));
    await flush(4);
    expect(state.opened).toEqual(['https://aff.example/shopee']);
    expect(dialog()).toBeNull();
  });

  it('lỗi ở đúng lần mở đã gửi: lời lỗi hiện trong tấm để bấm lại', async () => {
    const g = await open();
    await act(async () => g.fail(new Error('Sàn đã ngừng')));
    await flush(4);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain('Sàn đã ngừng');
  });
});
