// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Mini App pages/vouchers.tsx: `onRetry={() => q.refetch()}` ở cả khối lỗi chính lẫn dải "Chưa tải được mã bạn đã lưu". ErrorState chỉ khoá nút Thử lại
// (aria-busy, bỏ qua cú chạm thứ hai) khi xử lý trả Promise; `void` nuốt Promise nên nút không bao giờ báo bận.

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/ma-giam-gia',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/use-coupon-use', () => ({ useCouponUse: () => ({ copy: vi.fn(), use: vi.fn(), notice: null, cancel: vi.fn(), usingCode: null }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, retrySession: vi.fn(), sessionRateLimited: false }) }));

import { ApiError } from '@/lib/client-api';
import VouchersView from './vouchers-view';

const DAY = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const collectable = (code: string) => ({
  code, title: null, type: 'AMOUNT', value: 30_000, minOrder: 199_000, maxDiscount: null, startAt: iso(-DAY), endAt: iso(20 * DAY),
  newCustomerOnly: false, claimedCount: 0, usageLimit: null,
});
const wallet = (code: string) => ({ code, type: 'AMOUNT', value: 30_000, minOrder: 199_000, maxDiscount: null, endAt: iso(20 * DAY) });

let responses: Record<string, unknown>;
/** Giữ lời gọi GET tới `path` đang bay tới khi gọi hàm trả về. */
let gates: Record<string, Promise<void>> = {};
function hold(path: string) {
  let release!: () => void;
  gates[path] = new Promise<void>((r) => {
    release = r;
  });
  return release;
}
const callsTo = (path: string) => mocks.get.mock.calls.filter(([p]) => p === path);
let mounted: Rendered | null = null;
const mount = (qc?: QueryClient) => {
  mounted = render(<VouchersView />, qc);
  return mounted;
};
const text = () => document.body.textContent ?? '';
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === name) ?? null;
const buttons = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === name);

beforeEach(() => {
  nav.search = '';
  gates = {};
  mocks.post.mockReset();
  responses = {
    '/coupons/collectable': [collectable('NEW10')],
    '/coupons/collectable/mine': { claimed: [], newCustomerOnly: [] },
    '/me/coupons': [],
    '/me/coupons/history': [],
  };
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    await gates[path];
    const r = responses[path];
    if (r instanceof Error) throw r;
    return r;
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('VouchersView (web): "Thử lại" trả Promise để nút khoá (Mini ↔ web)', () => {
  it('kho lỗi chưa có dữ liệu: bấm Thử lại báo bận ngay (aria-busy), tải lại một lần, thẻ về thì khối lỗi biến mất', async () => {
    responses['/coupons/collectable'] = new ApiError('Lỗi máy chủ', 500);
    mount();
    await flush(8);
    expect(text()).toContain('Chưa tải được mã giảm giá');
    const retry = button('Thử lại')!;
    expect(retry.hasAttribute('aria-busy')).toBe(false);
    const before = callsTo('/coupons/collectable').length;
    responses['/coupons/collectable'] = [collectable('NEW10')];
    const release = hold('/coupons/collectable');
    click(retry);
    // Chưa qua một lượt hẹn giờ của react-query nên khối lỗi còn nguyên: chỉ khoá của ErrorState mới làm nút báo bận ở đây.
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(retry.disabled).toBe(false);
    release();
    await flush(8);
    expect(callsTo('/coupons/collectable').length - before).toBe(1);
    expect(text()).not.toContain('Chưa tải được mã giảm giá');
    expect(buttons('Lưu mã')).toHaveLength(1);
  });

  it('Mã của tôi: ví ĐÃ có dữ liệu rồi lần làm mới lỗi — chạm Thử lại hai lần ở hai khung hình chỉ gửi một lần tải lại, nút bận tới khi ví về', async () => {
    nav.search = 'tab=mine';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    mount(qc);
    await flush(8);
    expect(text()).toContain('Bạn chưa có mã nào dùng được');
    responses['/me/coupons'] = new ApiError('Lỗi máy chủ', 500);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['coupons'], exact: true });
    });
    await flush(2);
    expect(text()).toContain('Chưa tải được mã giảm giá');
    const retry = button('Thử lại')!;
    const before = callsTo('/me/coupons').length;
    responses['/me/coupons'] = [wallet('OWN')];
    const release = hold('/me/coupons');
    click(retry);
    await flush(2);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    click(retry);
    await flush(2);
    // Truy vấn còn dữ liệu cũ nên refetch thứ hai sẽ huỷ lượt đầu rồi gửi lại: chỉ khoá của nút chặn được.
    expect(callsTo('/me/coupons').length - before).toBe(1);
    release();
    await flush(8);
    expect(callsTo('/me/coupons').length - before).toBe(1);
    expect(text()).not.toContain('Chưa tải được mã giảm giá');
    expect(buttons('Dùng ngay')).toHaveLength(1);
  });

  it('dải "Chưa tải được mã bạn đã lưu" (tab Nhận mã, ví lỗi): bấm Thử lại báo bận ngay và tải lại ví một lần', async () => {
    responses['/me/coupons'] = new ApiError('Lỗi máy chủ', 500);
    mount();
    await flush(8);
    expect(text()).toContain('Chưa tải được mã bạn đã lưu');
    const retry = button('Thử lại')!;
    const before = callsTo('/me/coupons').length;
    responses['/me/coupons'] = [wallet('OWN')];
    const release = hold('/me/coupons');
    click(retry);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.disabled).toBe(false);
    release();
    await flush(8);
    expect(callsTo('/me/coupons').length - before).toBe(1);
    expect(text()).not.toContain('Chưa tải được mã bạn đã lưu');
  });
});
