// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ pathname: '/uu-dai' }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'authenticated' }) }));
vi.mock('@/lib/route-map', async (orig) => ({ ...(await orig<object>()), isWebRouteReady: () => true }));
vi.mock('@/lib/use-offers-dot', () => ({ useOffersDot: () => null }));

import BottomNav from './bottom-nav';

let mounted: Rendered | null = null;
let scrollTo: ReturnType<typeof vi.fn>;

const click = (href: string) => {
  const link = mounted!.container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!;
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  link.dispatchEvent(ev);
  return ev;
};

beforeEach(() => {
  mocks.pathname = '/uu-dai';
  scrollTo = vi.fn();
  vi.stubGlobal('scrollTo', scrollTo);
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  mounted = render(<BottomNav />);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe('BottomNav web — bấm lại tab đang mở', () => {
  it('cuộn mượt về đầu trang và chặn điều hướng lại cùng đường dẫn', () => {
    const ev = click('/uu-dai');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('bấm tab khác thì không cuộn, để liên kết điều hướng như thường', () => {
    click('/san-pham');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('khách bật giảm chuyển động thì nhảy thẳng về đầu, không cuộn mượt', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    click('/uu-dai');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });
});
