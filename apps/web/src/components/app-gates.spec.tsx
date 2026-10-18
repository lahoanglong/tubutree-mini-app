// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const store = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: { storage: { get: async () => store.value, set: async () => undefined } },
}));

import { AppGates } from './app-gates';

let mounted: Rendered | null = null;
beforeEach(() => {
  store.value = null;
  document.documentElement.removeAttribute('style');
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('AppGates', () => {
  it('không vẽ gì ra giao diện', async () => {
    mounted = render(<AppGates />);
    await flush();
    expect(mounted.container.innerHTML).toBe('');
  });

  it('áp cỡ chữ khách đã chọn ngay khi mở bất kỳ trang nào', async () => {
    store.value = JSON.stringify({ fontScale: 'large' });
    mounted = render(<AppGates />);
    await flush();
    expect(document.documentElement.style.fontSize).toBe('18px');
  });

  it('chưa chọn thì không đổi cỡ gốc', async () => {
    mounted = render(<AppGates />);
    await flush();
    expect(document.documentElement.style.fontSize).toBe('');
  });
});
