// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ pathname: '/', trackScreenView: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => m.pathname }));
vi.mock('@/lib/analytics', () => ({ trackScreenView: m.trackScreenView }));

import { ScreenTracker } from './screen-tracker';

let root: Root;
const show = (pathname: string) => {
  m.pathname = pathname;
  act(() => root.render(<ScreenTracker />));
};

beforeEach(() => {
  m.trackScreenView.mockClear();
  root = createRoot(document.createElement('div'));
});
afterEach(() => act(() => root.unmount()));

describe('ScreenTracker', () => {
  it('gửi một lần cho mỗi lần đổi đường dẫn; vẽ lại cùng đường dẫn không gửi thêm', () => {
    show('/');
    show('/');
    show('/san-pham/serum-x');
    show('/gio-hang');
    expect(m.trackScreenView.mock.calls.map((c) => c[0])).toEqual(['/', '/san-pham/serum-x', '/gio-hang']);
  });

  it('khu quản trị không gửi', () => {
    show('/admin');
    show('/admin/orders');
    expect(m.trackScreenView).not.toHaveBeenCalled();
  });
});
