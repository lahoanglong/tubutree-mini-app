// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dealerReviewLine } from '@tubutree/app-core/dealer-apply-copy';
import { applyPitch } from '@/lib/dealer-view';
import { GUEST_ONLY_WHILE_RESTORING } from '@/lib/restoring-swap';

type Detail = { slug: string; type: string; isSample?: boolean; collections: { items: unknown[] }[] };
const state = vi.hoisted(() => ({
  stores: [] as { slug: string }[] | Error,
  details: {} as Record<string, unknown>,
  detailCalls: [] as string[],
  config: null as unknown,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ status: 'idle', initialized: false, sessionUnavailable: false, user: null, retrySession: vi.fn() }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getStorefrontList: async () => {
    if (state.stores instanceof Error) throw state.stores;
    return state.stores;
  },
  getStorefront: async (slug: string) => {
    state.detailCalls.push(slug);
    const d = state.details[slug];
    if (d instanceof Error) throw d;
    return d ?? null;
  },
}));
vi.mock('@/lib/guest-checkout/server-config', () => ({ readPublicConfigOnServer: async () => state.config }));

import CtvRoute from './ctv/page';
import DealerRoute from './dai-ly/page';

/** HTML máy chủ của route (Server Component bọc trang client), đọc lại bằng DOM để so chữ khách thấy. */
async function ssr(route: () => Promise<ReactElement>) {
  const html = renderToString(<QueryClientProvider client={new QueryClient()}>{await route()}</QueryClientProvider>);
  const box = document.createElement('div');
  box.innerHTML = html;
  return box;
}
const guestSlot = (box: HTMLElement) =>
  Array.from(box.querySelectorAll<HTMLElement>('div')).find((d) => d.className === GUEST_ONLY_WHILE_RESTORING) ?? null;

const store = (slug: string, over: Partial<Detail> = {}): Detail => ({ slug, type: 'CTV', collections: [{ items: [{ id: 'i1' }] }], ...over });

beforeEach(() => {
  state.stores = [];
  state.details = {};
  state.detailCalls = [];
  state.config = null;
});

describe('/ctv dựng ở máy chủ: màn giới thiệu CTV có trong HTML đầu', () => {
  it('có nút đăng nhập mang returnTo và nút xem gian hàng CTV có hàng đầu tiên', async () => {
    state.stores = [{ slug: '' }, { slug: 'linh xanh' }, { slug: 'an' }];
    state.details = { 'linh xanh': store('linh xanh'), an: store('an') };
    const guest = guestSlot(await ssr(CtvRoute))!;
    expect(guest).not.toBeNull();
    expect(guest.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/ctv')}`);
    expect(guest.querySelector('[data-testid="ctv-sample-store"]')?.getAttribute('href')).toBe('/s/linh%20xanh');
  });

  it('máy còn cờ phiên: HTML đầu có sẵn ô khung chờ aria-hidden (CSS chỉ hiện khi <html data-restoring>)', async () => {
    const box = await ssr(CtvRoute);
    const skeleton = box.querySelector<HTMLElement>('[aria-hidden="true"] [data-testid="ctv-skeleton"]');
    expect(skeleton).not.toBeNull();
    expect(skeleton!.closest('[aria-hidden="true"]')!.className).toBe('hidden [html[data-restoring]_&]:block');
  });

  it('bỏ qua gian hàng đã gỡ (404), lỗi API, không phải CTV, gian hàng mẫu, chưa có món; chỉ đọc 3 ứng viên đầu', async () => {
    state.stores = ['go', 'loi', 'shop', 'mau', 'rong', 'tot'].map((slug) => ({ slug }));
    state.details = {
      loi: new Error('down'),
      shop: store('shop', { type: 'MERCHANT' }),
      mau: store('mau', { isSample: true }),
      rong: store('rong', { collections: [{ items: [] }] }),
      tot: store('tot'),
    };
    expect(guestSlot(await ssr(CtvRoute))!.querySelector('[data-testid="ctv-sample-store"]')).toBeNull();
    expect(state.detailCalls).toEqual(['go', 'loi', 'shop']);
    state.stores = ['mau', 'rong', 'tot'].map((slug) => ({ slug }));
    expect(guestSlot(await ssr(CtvRoute))!.querySelector('[data-testid="ctv-sample-store"]')?.getAttribute('href')).toBe('/s/tot');
  });

  it('API danh sách gian hàng lỗi hay rỗng: trang vẫn dựng, không có nút xem gian hàng', async () => {
    state.stores = new Error('down');
    expect(guestSlot(await ssr(CtvRoute))!.querySelector('[data-testid="ctv-sample-store"]')).toBeNull();
    state.stores = [];
    expect(guestSlot(await ssr(CtvRoute))!.querySelector('[data-testid="ctv-sample-store"]')).toBeNull();
  });
});

describe('/dai-ly dựng ở máy chủ: số thật của cấu hình công khai trong HTML đầu', () => {
  it('chiết khấu tối đa và giờ duyệt lấy từ cấu hình công khai', async () => {
    state.config = { dealer: { maxDiscountPct: 12, reviewHours: 24 } };
    const guest = guestSlot(await ssr(DealerRoute))!;
    expect(guest.textContent).toContain(`${applyPitch(12)} ${dealerReviewLine(24)}`);
    expect(guest.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/dai-ly')}`);
  });

  it('cấu hình lỗi hay số bậy: chữ chung, không in số', async () => {
    state.config = { dealer: { maxDiscountPct: -1, reviewHours: 'x' } };
    const guest = guestSlot(await ssr(DealerRoute))!;
    expect(guest.textContent).toContain(`${applyPitch(null)} ${dealerReviewLine(null)}`);
    expect(applyPitch(12)).not.toBe(applyPitch(null));
  });
});
