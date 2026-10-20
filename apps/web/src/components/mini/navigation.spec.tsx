// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { click, typeInto } from '@/test-utils/dom';
import { mount } from './harness';

const nav = vi.hoisted(() => ({ pathname: '/san-pham/abc', back: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ back: nav.back, push: nav.push }),
}));

import BackButton from './back-button';
import { SegmentedTabs } from './segmented-tabs';
import { ScrollRow } from './scroll-row';
import { SearchField } from './search-field';

beforeEach(() => {
  nav.pathname = '/san-pham/abc';
  nav.back.mockClear();
  nav.push.mockClear();
  document.body.className = '';
  try { sessionStorage.clear(); } catch { /* không có */ }
});

describe('BackButton', () => {
  it('trang con: nút tròn nổi 44px trên-trái, nhãn "Quay lại", gắn with-back-btn lên body', () => {
    const b = mount(<BackButton />).container.querySelector('button')!;
    expect(b.getAttribute('aria-label')).toBe('Quay lại');
    expect(b.style.position).toBe('fixed');
    expect(b.style.left).toBe('12px');
    expect(b.style.width).toBe('44px');
    expect(b.style.borderRadius).toBe('50%');
    expect(b.style.top).toBe('calc(var(--safe-top) + 8px)');
    expect(document.body.classList.contains('with-back-btn')).toBe(true);
  });

  it.each(['/', '/san-pham', '/vuon-xanh', '/tai-khoan/don-hang', '/tai-khoan'])('ẩn ở trang gốc %s', (p) => {
    nav.pathname = p;
    expect(mount(<BackButton />).container.querySelector('button')).toBeNull();
    expect(document.body.classList.contains('with-back-btn')).toBe(false);
  });

  it('gỡ with-back-btn khi gỡ nút', () => {
    const m = mount(<BackButton />);
    m.unmount();
    expect(document.body.classList.contains('with-back-btn')).toBe(false);
    m.container.remove();
  });
});

describe('BackButton lớp phủ', () => {
  it('nút nổi thấp hơn Sheet (z-50) và OnboardingGate (z-60) để lớp phủ che được nó', () => {
    const b = mount(<BackButton />).container.querySelector('button')!;
    expect(Number(b.style.zIndex)).toBeLessThan(50);
  });

  it('hai bản cùng gắn: gỡ một bản không làm mất with-back-btn của bản còn lại', () => {
    const a = mount(<BackButton />);
    mount(<BackButton />);
    a.unmount();
    expect(document.body.classList.contains('with-back-btn')).toBe(true);
    a.container.remove();
  });
});

