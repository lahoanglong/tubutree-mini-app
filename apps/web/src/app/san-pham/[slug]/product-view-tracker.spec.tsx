// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ trackPurchase: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackPurchase: m.trackPurchase }));

import { ProductViewTracker } from './product-view-tracker';

let root: Root;
const show = (props: { slug: string; hasVideo?: boolean; imageCount?: number; inStock?: boolean }) =>
  act(() =>
    root.render(
      <StrictMode>
        <ProductViewTracker slug={props.slug} hasVideo={props.hasVideo ?? false} imageCount={props.imageCount ?? 3} inStock={props.inStock ?? true} />
      </StrictMode>,
    ),
  );

beforeEach(() => {
  m.trackPurchase.mockClear();
  root = createRoot(document.createElement('div'));
});
afterEach(() => act(() => root.unmount()));

describe('ProductViewTracker', () => {
  it('một lần cho mỗi slug: vẽ lại, đổi tồn kho hay số ảnh (tải lại bản ISR) không phát thêm', () => {
    show({ slug: 'serum-x', hasVideo: true, imageCount: 4 });
    show({ slug: 'serum-x', hasVideo: true, imageCount: 4 });
    show({ slug: 'serum-x', hasVideo: true, imageCount: 5, inStock: false });
    expect(m.trackPurchase).toHaveBeenCalledTimes(1);
    expect(m.trackPurchase).toHaveBeenCalledWith('product_viewed', { productSlug: 'serum-x', hasVideo: true, imageCount: 4, inStock: true });
  });

  it('sang sản phẩm khác trên cùng khung thì phát cho sản phẩm mới; số ảnh kẹp trong 0..100', () => {
    show({ slug: 'serum-x' });
    show({ slug: 'kem-y', imageCount: 250 });
    expect(m.trackPurchase).toHaveBeenCalledTimes(2);
    expect(m.trackPurchase).toHaveBeenLastCalledWith('product_viewed', { productSlug: 'kem-y', hasVideo: false, imageCount: 100, inStock: true });
  });
});
