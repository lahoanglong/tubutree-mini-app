import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  handlers: new Map<string, (d?: unknown) => void>(),
  off: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('zmp-sdk/apis', () => ({
  EventName: { OpenApp: 'h5.event.open.mp' },
  events: {
    on: (name: string, cb: (d?: unknown) => void) => mocks.handlers.set(name, cb),
    off: mocks.off,
  },
}));

import { OpenAppRouter, routerPathFromOpenApp } from './open-app-router';

describe('routerPathFromOpenApp', () => {
  it.each([
    ['/zapps/2070857098114207963/points/scan', '/points/scan'],
    ['/zapps/2070857098114207963/points/scan?src=shopee&card=2611', '/points/scan?src=shopee&card=2611'],
    ['/points/scan?src=lazada', '/points/scan?src=lazada'],
    ['/zapps/123', '/'],
    ['/zapps/123?src=x', '/?src=x'],
  ])('%s -> %s', (input, expected) => {
    expect(routerPathFromOpenApp(input)).toBe(expected);
  });
  it.each([[undefined], [''], ['points/scan'], [42]])('bỏ qua %j', (input) => {
    expect(routerPathFromOpenApp(input)).toBeNull();
  });
});

describe('OpenAppRouter', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.handlers.clear();
    mocks.off.mockClear();
  });
  it('OpenApp kèm path: chuyển sang màn đó', () => {
    render(<OpenAppRouter />);
    mocks.handlers.get('h5.event.open.mp')!({ path: '/zapps/1/points/scan?src=shopee&card=2611' });
    expect(mocks.navigate).toHaveBeenCalledWith('/points/scan?src=shopee&card=2611');
  });
  it('OpenApp không có path: không đổi màn', () => {
    render(<OpenAppRouter />);
    mocks.handlers.get('h5.event.open.mp')!({});
    mocks.handlers.get('h5.event.open.mp')!(undefined);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('gỡ nghe khi tháo component', () => {
    const { unmount } = render(<OpenAppRouter />);
    unmount();
    expect(mocks.off).toHaveBeenCalledWith('h5.event.open.mp', expect.any(Function));
  });
});
