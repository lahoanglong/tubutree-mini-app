// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
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
  mocks.support = { hotline: '0984606774' };
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
    const link = mounted.container.querySelector('a[href^="tel:"]')!;
    expect(link.textContent).toBe('Gọi 0984 606 774');
    expect(link.getAttribute('href')).toBe('tel:0984606774');
  });

  it('"Gọi <số>" dùng số đều (tabular-nums) và vẫn không ngắt dòng', async () => {
    mounted = render(<SupportHotline />);
    await flush();
    const link = mounted.container.querySelector('a[href^="tel:"]')!;
    expect(link.classList.contains('tabular-nums')).toBe(true);
    expect(link.classList.contains('whitespace-nowrap')).toBe(true);
  });

  it('admin để trống hotline: ẩn cả dòng, không có chữ "Cần hỗ trợ?" lẻ loi', async () => {
    mocks.support = { hotline: null };
    mounted = render(<SupportHotline />);
    await flush();
    expect(mounted.container.innerHTML).toBe('');
  });

  it('không có QueryClientProvider: ẩn dòng này và không ném lỗi, như Mini App', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    expect(() =>
      act(() => {
        root.render(<SupportHotline />);
      }),
    ).not.toThrow();
    expect(container.innerHTML).toBe('');
    act(() => root.unmount());
    container.remove();
  });
});
