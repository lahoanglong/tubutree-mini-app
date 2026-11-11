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
});

// Wave 102B: kết quả của lệnh "Mua sắm" nhớ theo TỪNG SÀN. Click đã được ghi nhận ở máy chủ nên lỗi hay liên kết bị chặn popup của sàn đã gửi không được bỏ im
// chỉ vì khách đã đóng tấm: nó hiện khi khách mở đúng sàn đó, và không bao giờ hiện ở tấm của sàn khác.
describe('/hoan-tien: phản hồi muộn ghi vào ô của đúng sàn đã gửi', () => {
  const alertText = () => dialog()?.querySelector('[role="alert"]')?.textContent ?? null;
  const blockedLinkEl = () => Array.from(dialog()?.querySelectorAll<HTMLAnchorElement>('a') ?? []).find((a) => a.textContent === 'Mở sàn') ?? null;
  const reopen = async (name: string) => {
    click(tile(name));
    await flush(2);
  };

  it('sàn khác đang mở: liên kết không hợp lệ của Shopee không hiện ở tấm Lazada, tab trống được đóng; mở lại Shopee thấy lời báo', async () => {
    const g = await sentThenReopened('Lazada');
    await act(async () => g.release({ deeplink: 'javascript:alert(1)' }));
    await flush(4);
    expect(state.win!.close).toHaveBeenCalled();
    expect(alertText()).toBeNull();
    closeByBackdrop();
    await reopen('Shopee');
    expect(alertText()).toContain('Không mở được liên kết sàn');
  });

  it('sàn khác đang mở: lỗi của Shopee không hiện ở tấm Lazada, tab trống được đóng; mở lại Shopee vẫn thấy lỗi', async () => {
    const g = await sentThenReopened('Lazada');
    await act(async () => g.fail(new Error('Sàn đã ngừng')));
    await flush(4);
    expect(state.win!.close).toHaveBeenCalled();
    expect(alertText()).toBeNull();
    closeByBackdrop();
    await reopen('Shopee');
    expect(alertText()).toContain('Sàn đã ngừng');
  });

  it('tab trống bị chặn, sàn khác đang mở: liên kết Shopee không hiện ở tấm Lazada; mở lại Shopee thấy liên kết dùng được', async () => {
    const g = await sentThenReopened('Lazada', true);
    await act(async () => g.release({ deeplink: 'https://aff.example/shopee' }));
    await flush(4);
    expect(dialog()!.textContent).not.toContain('Trình duyệt đã chặn cửa sổ mới');
    closeByBackdrop();
    await reopen('Shopee');
    expect(dialog()!.textContent).toContain('Trình duyệt đã chặn cửa sổ mới');
    expect(blockedLinkEl()!.getAttribute('href')).toBe('https://aff.example/shopee');
  });

  it('khách mở lại ĐÚNG sàn đã gửi: liên kết không hợp lệ và lỗi hiện ngay trong tấm đó', async () => {
    const g = await sentThenReopened('Shopee');
    await act(async () => g.release({ deeplink: 'javascript:alert(1)' }));
    await flush(4);
    expect(state.win!.close).toHaveBeenCalled();
    expect(alertText()).toContain('Không mở được liên kết sàn');
    closeByBackdrop();
    const g2 = await sentThenReopened('Shopee');
    await act(async () => g2.fail(new Error('Sàn đã ngừng')));
    await flush(4);
    expect(alertText()).toContain('Sàn đã ngừng');
  });

  it('khách mở lại ĐÚNG sàn đã gửi, tab bị chặn: liên kết dùng được hiện ngay trong tấm đó', async () => {
    const g = await sentThenReopened('Shopee', true);
    await act(async () => g.release({ deeplink: 'https://aff.example/shopee' }));
    await flush(4);
    expect(blockedLinkEl()!.getAttribute('href')).toBe('https://aff.example/shopee');
  });

  it('đóng tấm một sàn không nuốt ô của sàn khác: lỗi muộn của Shopee còn nguyên sau khi khách xem rồi đóng tấm Lazada', async () => {
    const g = await sentThenReopened('Lazada');
    await act(async () => g.fail(new Error('Sàn đã ngừng')));
    await flush(4);
    const g2 = gate();
    click(buyBtn());
    await flush();
    await act(async () => g2.fail(new Error('Lazada bận')));
    await flush(4);
    expect(alertText()).toContain('Lazada bận');
    closeByBackdrop();
    await reopen('Shopee');
    expect(alertText()).toContain('Sàn đã ngừng');
    closeByBackdrop();
    await reopen('Lazada');
    expect(alertText()).toBeNull();
  });

  it('bấm "Mua sắm" lại ở sàn đó xoá ô của sàn đó (lời báo cũ biến mất lúc đang gửi), không đụng ô sàn khác', async () => {
    mounted = render(<CashbackPage />);
    await flush(8);
    const g = gate();
    click(tile('Shopee'));
    click(buyBtn());
    await flush();
    await act(async () => g.fail(new Error('Sàn đã ngừng')));
    await flush(4);
    expect(alertText()).toContain('Sàn đã ngừng');
    gate();
    click(buyBtn());
    await flush();
    expect(alertText()).toBeNull();
  });

  it('lệnh sàn A còn bay: bấm "Mua sắm" ở sàn B bị chặn, chỉ có MỘT tab và MỘT lệnh, tab của A vẫn tới sàn A', async () => {
    mounted = render(<CashbackPage />);
    await flush(8);
    const g = gate();
    click(tile('Shopee'));
    click(buyBtn());
    await flush();
    closeByBackdrop();
    click(tile('Lazada'));
    await flush(2);
    expect(buyBtn().getAttribute('aria-busy')).toBe('true');
    click(buyBtn());
    await flush();
    expect(window.open).toHaveBeenCalledTimes(1);
    await act(async () => g.release({ deeplink: 'https://aff.example/shopee' }));
    await flush(4);
    expect(state.opened).toEqual(['https://aff.example/shopee']);
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
