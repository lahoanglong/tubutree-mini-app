// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ support: { hotline: '0984606774' } as unknown, error: false }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async () => {
      if (mocks.error) throw new Error('mạng');
      return { support: mocks.support };
    },
  },
}));

import { SupportHotline } from './support-hotline';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  mocks.error = false;
});

describe('SupportHotline', () => {
  it('"Gọi <số>" là một khối không ngắt dòng, như Mini App', async () => {
    mounted = render(<SupportHotline />);
    await flush();
    const link = mounted.container.querySelector('a[href^="tel:"]')!;
    expect(link.textContent).toBe('Gọi 0984 606 774');
    expect(link.className).toContain('whitespace-nowrap');
    expect(link.getAttribute('href')).toBe('tel:0984606774');
  });

  it('lỗi đọc cấu hình vẫn còn số mặc định', async () => {
    mocks.error = true;
    mounted = render(<SupportHotline />);
    await flush();
    expect(mounted.container.querySelector('a[href^="tel:"]')?.textContent).toBe('Gọi 0984 606 774');
  });
});
