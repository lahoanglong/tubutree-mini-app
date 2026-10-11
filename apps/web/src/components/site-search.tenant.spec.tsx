// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://ctv-an.tubutree.com/" }
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Trên host gian hàng CTV, middleware rewrite `/` sang /s/{subdomain} nên ?q= bị bỏ qua — ô tìm kiếm
// ở header sẽ đưa khách về lại trang gian hàng thay vì kết quả, nên không hiển thị ở đó.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import SiteSearch from './site-search';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('SiteSearch trên host gian hàng CTV', () => {
  it('không hiển thị ô tìm kiếm', async () => {
    expect(window.location.hostname).toBe('ctv-an.tubutree.com');
    const r = render(<SiteSearch />);
    mounted.push(r);
    await flush(2);
    expect(r.container.querySelector('form')).toBeNull();
    expect(r.container.querySelector('input')).toBeNull();
  });
});
