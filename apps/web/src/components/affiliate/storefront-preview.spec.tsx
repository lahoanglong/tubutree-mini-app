// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import type { StorefrontEdit } from '@tubutree/app-core/api/storefront';
import { StorefrontPreview } from './storefront-preview';

vi.mock('@/components/product-card', () => ({
  default: ({ product }: { product: { name: string } }) => (
    <div>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/san-pham/x">{product.name}</a>
      <button type="button" aria-label="Yêu thích">tim</button>
    </div>
  ),
}));

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
  it('cả khung preview là inert: link và nút bên trong không nhận Tab/Enter', () => {
    mounted = render(<StorefrontPreview sf={sf} />);
    const frame = mounted.container.querySelector('[data-testid="storefront-preview"]')!;
    expect(frame.hasAttribute('inert')).toBe(true);
    const focusables = frame.querySelectorAll('a[href], button');
    expect(focusables.length).toBeGreaterThan(0);
    for (const el of Array.from(focusables)) expect(el.closest('[inert]')).toBe(frame);
  });
});
