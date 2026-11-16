// @vitest-environment jsdom
// File giữ đuôi .ts (không phải .tsx) theo brief — dùng React.createElement thay vì cú pháp JSX
// để tránh esbuild parse .ts bằng loader 'ts' (không hỗ trợ JSX, chỉ .tsx mới có loader 'tsx').
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toRouteTemplate } from '@tubutree/shared-types';
import { MINI_DYNAMIC_ROUTES, miniRouteTemplate, useScreenTracker } from './use-screen-tracker';

vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
import { trackEvent } from '../services/analytics';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(MemoryRouter, { initialEntries: ['/home'] }, children);
}

describe('useScreenTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });


  it('phát screen_viewed với route hiện tại khi mount, chưa có referrerRoute', () => {
    renderHook(() => useScreenTracker(), { wrapper });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('screen_viewed', 'miniapp', {
      route: '/home',
      referrerRoute: null,
      msToContent: expect.any(Number),
    });
  });

  it('mỗi lần đổi route phát lại, route và referrerRoute là mẫu route (không mang slug, mã đơn thật)', () => {
    // Hook kết hợp useNavigate() + useScreenTracker() để mô phỏng điều hướng thật (không chỉ re-render): chứng minh effect chạy lại theo
    // location.pathname thay vì chỉ chạy 1 lần lúc mount.
    const { result } = renderHook(
      () => {
        const navigate = useNavigate();
        useScreenTracker();
        return navigate;
      },
      { wrapper },
    );

    act(() => result.current('/product/nuoc-rua-chen-bo-ket'));
    act(() => result.current('/order/TB2611ABC'));
    act(() => result.current('/feed/events'));
    act(() => result.current('/recycle/r/abc123/edit'));

    const calls = vi.mocked(trackEvent).mock.calls.map((c) => c[2]);
    expect(calls.map((p) => [p.route, p.referrerRoute])).toEqual([
      ['/home', null],
      ['/product/:slug', '/home'],
      ['/order/:code', '/product/:slug'],
      ['/feed/events', '/order/:code'],
      ['/recycle/r/:id/edit', '/feed/events'],
    ]);
    expect(calls.every((p) => !('prevRoute' in p))).toBe(true);
  });
});

describe('miniRouteTemplate', () => {
  const appRoutes = [...readFileSync(resolve(__dirname, '../components/app.tsx'), 'utf8').matchAll(/<Route path="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((p) => p !== '*');

  it('mọi route có tham số của app.tsx đều nằm trong MINI_DYNAMIC_ROUTES', () => {
    const dynamic = appRoutes.filter((p) => p.includes(':'));
    expect(dynamic.length).toBeGreaterThan(10);
    expect(dynamic.filter((p) => !MINI_DYNAMIC_ROUTES.includes(p))).toEqual([]);
  });

  it('cho cùng kết quả với toRouteTemplate của shared-types trên mọi route của app và đường dẫn lạ', () => {
    const samples = [
      ...appRoutes.map((p) => p.replace(/:[A-Za-z]+/g, 'TB2611-AbC_9')),
      '/product/nuoc-rua-chen',
      '/khong-co/ABC123/xyz',
      '/feed/events',
      '/feed/leaderboard',
      '/',
    ];
    for (const path of samples) expect([path, miniRouteTemplate(path)]).toEqual([path, toRouteTemplate(path, MINI_DYNAMIC_ROUTES)]);
  });
});
