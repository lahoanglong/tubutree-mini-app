// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ get: vi.fn(), phase: 'authenticated' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));

import { TubuQueryClient } from './query-client';
import { useMeSummary } from './use-me-summary';

/** Máy chủ giả: số đơn đang xử lý và tin chưa đọc đổi theo hành động của khách. */
const server = { active: 1, pending: 1, unread: 3, subs: 0 };
const body = () => ({
  orders: { pending_payment: server.pending, processing: 0, shipping: 0, delivered: 0, closed: 0, active: server.active },
  unreadNotifications: server.unread,
  activeSubscriptions: server.subs,
});

function setup() {
  const client = new TubuQueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // Badge thanh đáy, số đơn ở Cá nhân, chuông và các mutation thật của app cùng sống một lúc.
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
        badge: useMeSummary({ select: (s) => s.orders.active, staleTime: 30_000 }).data,
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
    { client },
  );
  return { client, hook };
}
const summaryCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/me/summary').length;

describe('/me/summary (web): một nguồn, làm mới theo hành động của khách', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'authenticated';
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

  it('làm mới ["me"] (Vườn Xanh tưới, thu hoạch; đổi hồ sơ) KHÔNG gọi lại summary', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.badge).toBe(1));
    await act(async () => {
      await hook.result.current.qc.invalidateQueries({ queryKey: ['me'] });
    });
    expect(summaryCalls()).toBe(1);
  });

  it('khoá không liên quan không gọi lại summary; kéo để làm mới nhiều gốc khoá liền nhau chỉ tốn MỘT lời gọi thêm', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.badge).toBe(1));
    await act(async () => {
      await hook.result.current.qc.invalidateQueries({ queryKey: ['wallet'] });
    });
    expect(summaryCalls()).toBe(1);
    server.active = 7;
    await act(async () => {
      await Promise.all(['orders', 'notifications', 'subscriptions'].map((k) => hook.result.current.qc.invalidateQueries({ queryKey: [k] })));
    });
    await waitFor(() => expect(hook.result.current.badge).toBe(7));
    expect(summaryCalls()).toBe(2);
  });

  it('race: summary đang tải lại dở với số cũ, rồi đọc tin (làm mới ["notifications"]): kết quả cuối là số mới', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.unread).toBe(3));
    let releaseOld: () => void = () => {};
    const oldBody = body();
    mocks.get.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = () => resolve(oldBody); }));
    await act(async () => {
      void hook.result.current.qc.refetchQueries({ queryKey: ['me-summary'] });
    });
    await act(async () => hook.result.current.markRead.mutate());
    await act(async () => releaseOld());
    await waitFor(() => expect(hook.result.current.unread).toBe(2));
    expect(hook.result.current.qc.getQueryState(['me-summary'])?.isInvalidated).toBe(false);
  });

  it('summary lỗi: không có số (chưa từng tải) thay vì số sai', async () => {
    mocks.get.mockRejectedValue(new Error('500'));
    const { client, hook } = setup();
    await waitFor(() => expect(client.getQueryState(['me-summary'])?.status).toBe('error'));
    expect(hook.result.current).toMatchObject({ badge: undefined, pending: undefined, unread: undefined, subs: undefined });
  });

  it('khách chưa đăng nhập: không gọi', () => {
    mocks.phase = 'guest';
    const { hook } = setup();
    expect(hook.result.current.badge).toBeUndefined();
    expect(summaryCalls()).toBe(0);
  });
});
