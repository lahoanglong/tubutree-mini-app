// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import type { StorefrontEdit } from '@tubutree/app-core/api/storefront';
import { StorefrontPreview } from './storefront-preview';

vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => ({}), post: async () => ({}), delete: async () => ({}) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

let mounted: Rendered | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const sf = {
  title: 'Shop An', slug: 'shop-an', headerNote: null, coverUrl: null, avatarUrl: null,
  collections: [{ id: 'c1', items: [{ id: 'i1', isHidden: false, hiddenReason: null, product: { id: 'p1', name: 'Kem', slug: 'kem', basePrice: 1000, salePrice: null } }] }],
} as unknown as StorefrontEdit;

describe('StorefrontPreview', () => {
  it('cả khung preview là inert: link và nút bên trong không nhận Tab/Enter', async () => {
    mounted = render(<StorefrontPreview sf={sf} />);
    await flush();
    const frame = mounted.container.querySelector('[data-testid="storefront-preview"]')!;
    expect(frame.hasAttribute('inert')).toBe(true);
    const focusables = frame.querySelectorAll('a[href], button');
    expect(focusables.length).toBeGreaterThan(0);
    // Thẻ dựng bằng chính ShopSection nên có cả tim như khách thấy; nó nằm trong khung inert nên không nhận Tab/Enter.
    for (const el of Array.from(focusables)) expect(el.closest('[inert]')).toBe(frame);
  });
});
