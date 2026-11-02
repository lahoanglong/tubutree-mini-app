import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), status: 'authenticated' }));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));

import { TubuQueryClient } from '../services/query-client';
import { useActiveOrderCount } from './use-active-order-count';
import { useMeSummary } from './use-me-summary';

/** Máy chủ giả: số đơn đang xử lý và tin chưa đọc đổi theo hành động của khách. */
const server = { active: 1, pending: 1, unread: 3, subs: 0 };
const body = () => ({
  orders: { pending_payment: server.pending, processing: 0, shipping: 0, delivered: 0, closed: 0, active: server.active },
  unreadNotifications: server.unread,
  activeSubscriptions: server.subs,
});

function setup() {
  const client = new TubuQueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  // Thanh đáy, số đơn ở Cá nhân, chuông và các mutation thật của app cùng sống một lúc, như Trang chủ/Cá nhân thật.
  const hook = renderHook(
    () => {
      const qc = useQueryClient();
      const place = useMutation({
        mutationFn: async () => {
          server.active += 1;
          server.pending += 1;
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['orders'] }),
      });
      const cancel = useMutation({
        mutationFn: async () => {
          server.active -= 1;
          server.pending -= 1;
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['orders'] }),
      });
      const markRead = useMutation({
        mutationFn: async () => {
          server.unread -= 1;
        },
        onSettled: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
      });
      const subscribe = useMutation({
        mutationFn: async () => {
          server.subs += 1;
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['subscriptions'] }),
      });
      return {
        badge: useActiveOrderCount(true),
        pending: useMeSummary().data?.orders.pending_payment,
        unread: useMeSummary({ select: (s) => s.unreadNotifications }).data,
        subs: useMeSummary({ select: (s) => s.activeSubscriptions }).data,
        qc,
        place,
        cancel,
        markRead,
        subscribe,
      };
    },
    { wrapper },
  );
  return { client, hook };
}
const summaryCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/me/summary').length;

describe('/me/summary: một nguồn, làm mới theo hành động của khách', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    Object.assign(server, { active: 1, pending: 1, unread: 3, subs: 0 });
    mocks.get.mockImplementation(async () => body());
  });

  it('badge thanh đáy, số đơn ở Cá nhân và chuông cùng một lời gọi, cùng một số', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.badge).toBe(1));
    expect(hook.result.current).toMatchObject({ badge: 1, pending: 1, unread: 3, subs: 0 });
    expect(summaryCalls()).toBe(1);
  });

  it('đặt đơn làm badge thanh đáy và số Chờ thanh toán ở Cá nhân cùng tăng', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.badge).toBe(1));
    await act(async () => hook.result.current.place.mutate());
    await waitFor(() => expect(hook.result.current.badge).toBe(2));
    expect(hook.result.current.pending).toBe(2);
  });

  it('huỷ đơn làm badge thanh đáy và số Chờ thanh toán cùng giảm', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.badge).toBe(1));
    await act(async () => hook.result.current.cancel.mutate());
    await waitFor(() => expect(hook.result.current.badge).toBe(0));
    expect(hook.result.current.pending).toBe(0);
  });

  it('đọc tin làm số chưa đọc giảm', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.unread).toBe(3));
    await act(async () => hook.result.current.markRead.mutate());
    await waitFor(() => expect(hook.result.current.unread).toBe(2));
  });

  it('đăng ký gói định kỳ làm số gói đổi', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.subs).toBe(0));
    await act(async () => hook.result.current.subscribe.mutate());
    await waitFor(() => expect(hook.result.current.subs).toBe(1));
  });

  it('làm mới ["me"] (đổi hồ sơ, game, checkout) cũng làm mới summary vì khoá nằm dưới tiền tố đó', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.badge).toBe(1));
    server.active = 4;
    await act(async () => void hook.result.current.qc.invalidateQueries({ queryKey: ['me'] }));
    await waitFor(() => expect(hook.result.current.badge).toBe(4));
  });

  it('khoá không liên quan (ví, sản phẩm) không gọi lại summary', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.badge).toBe(1));
    await act(async () => {
      await hook.result.current.qc.invalidateQueries({ queryKey: ['wallet'] });
      await hook.result.current.qc.invalidateQueries({ queryKey: ['products'] });
    });
    expect(summaryCalls()).toBe(1);
  });

  it('kéo để làm mới (orders + notifications + subscriptions liền nhau) chỉ tốn MỘT lời gọi summary', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.badge).toBe(1));
    server.active = 7;
    await act(async () => {
      await Promise.all(['orders', 'notifications', 'subscriptions'].map((k) => hook.result.current.qc.invalidateQueries({ queryKey: [k] })));
    });
    await waitFor(() => expect(hook.result.current.badge).toBe(7));
    expect(summaryCalls()).toBe(2);
  });

  it('summary lỗi sau khi đã có số: không đổi thành số sai, query ở trạng thái lỗi', async () => {
    const { client, hook } = setup();
    await waitFor(() => expect(hook.result.current.badge).toBe(1));
    mocks.get.mockRejectedValue(new Error('500'));
    await act(async () => hook.result.current.cancel.mutate());
    await waitFor(() => expect(client.getQueryState(['me', 'summary'])?.status).toBe('error'));
    expect(hook.result.current.badge).toBe(1);
  });

  it('khách chưa đăng nhập: không gọi', () => {
    mocks.status = 'idle';
    const { hook } = setup();
    expect(hook.result.current).toMatchObject({ badge: 0, pending: undefined, unread: undefined });
    expect(summaryCalls()).toBe(0);
  });
});
