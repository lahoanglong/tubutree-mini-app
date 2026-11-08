import { render } from '@testing-library/react';
import type { ProductDetail } from '@tubutree/app-core/api/catalog';
import { featuredAffiliateProducts } from '@tubutree/app-core/commerce/affiliate-share';
import { buildOrderTimelineSteps } from '@tubutree/app-core/commerce/order-timeline';
import { Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { AffiliateFeaturedProducts } from '../affiliate/featured-products';
import { OrderTimelineTracker } from '../orders/order-timeline-tracker';
import { Button } from './button';
import { Chip } from './chip';
import { Checkbox, Radio, Switch } from './form';
import { IconButton } from './icon-button';
import { ListRow } from './list-row';
import { CouponRemovedNotice } from '../checkout/coupon-removed-notice';
import { QuantitySelector } from './quantity-selector';
import { ProductStoryShowcase } from './product-story-showcase';
import { SegmentedTabs } from './segmented-tabs';
import { StoryReelStrip } from './story-reel-strip';
import { FreeshipAddonRail } from './freeship-addon-rail';
import { CartVoucherHintStrip } from './cart-voucher-hint-strip';

/**
 * Vùng chạm >= 44x44 (C-021, WCAG 2.5.5) cho mọi phần tử bấm được mà DS v2 dựng. jsdom không có layout,
 * nên đọc kích thước KHAI BÁO: width/height/min* >= 44 trên chính phần tử hoặc cha bọc ngay trên nó,
 * hoặc lớp `tubu-hit-44*` (pseudo-element 44px). Component mới thêm vào danh sách này sẽ bị bắt nếu quên.
 */
const storyProduct = {
  id: 'p', slug: 's', brand: 'Tubu', name: 'Sp', images: [], thumbnail: null, variations: [], certifications: [],
} as unknown as ProductDetail;
const storyConfig = {
  version: 1 as const,
  enabled: true,
  scenes: [
    { kind: 'variant_arc' as const, items: [{ variationId: 'a', label: 'A', ambient: 'leaf' as const }, { variationId: 'b', label: 'B', ambient: 'sky' as const }] },
    { kind: 'ingredient_assembly' as const, steps: [{ title: 'T', body: 'B', layers: [] }, { title: 'T2', body: 'B2', layers: [] }] },
  ],
};

const featured = featuredAffiliateProducts(
  [{ id: 'p1', name: 'Ly tre', slug: 'ly-tre', thumbnail: null, basePrice: 100000, salePrice: null, maxAffiliateRate: 10 }],
  { baseUrl: 'https://zalo.me/s/1', affiliateCode: 'TUBU01', productPath: '/product' },
);

const px = (v: string): number => (v.endsWith('px') ? parseFloat(v) : 0);

function declared(el: HTMLElement, axis: 'w' | 'h'): number {
  const s = el.style;
  return Math.max(px(axis === 'w' ? s.width : s.height), px(axis === 'w' ? s.minWidth : s.minHeight));
}

function reaches44(el: HTMLElement): boolean {
  if (/\btubu-hit-44(-square)?\b/.test(el.className)) return true;
  for (let node: HTMLElement | null = el; node && node.parentElement !== document.body; node = node.parentElement) {
    if (declared(node, 'w') >= 44 && declared(node, 'h') >= 44) return true;
    // Chiều rộng do bố cục quyết định: nút ZaUI (min-width 120px trong CSS) và hàng <div> block full-width.
    if (declared(node, 'h') >= 44 && (/\bzaui-btn\b/.test(node.className) || node.tagName === 'DIV')) return true;
  }
  return false;
}

const INTERACTIVE = 'button, [role="button"], [role="tab"], input';

function interactiveIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(INTERACTIVE));
}

describe('vùng chạm DS v2 >= 44x44', () => {
  const cases: [string, () => JSX.Element][] = [
    ['Button md', () => <Button>A</Button>],
    ['Button lg', () => <Button size="lg">A</Button>],
    ['IconButton md', () => <IconButton icon={Search} label="Tìm" />],
    ['IconButton sm', () => <IconButton icon={Search} label="Tìm" size="sm" />],
    ['Chip md', () => <Chip>A</Chip>],
    ['Chip sm', () => <Chip size="sm">A</Chip>],
    ['SegmentedTabs', () => <SegmentedTabs items={[{ key: 'a', label: 'A' }]} value="a" onChange={() => {}} />],
    ['QuantitySelector md', () => <QuantitySelector value={2} max={9} size="md" onChange={() => {}} />],
    ['QuantitySelector sm', () => <QuantitySelector value={2} max={9} size="sm" onChange={() => {}} />],
    ['ListRow', () => <ListRow title="Địa chỉ" onPress={() => {}} />],
    ['Checkbox có nhãn', () => <Checkbox label="A" checked={false} onChange={() => {}} />],
    ['Checkbox flush (ô chọn dòng giỏ)', () => <Checkbox flush aria-label="A" checked={false} onChange={() => {}} />],
    ['Radio có nhãn', () => <Radio label="A" checked={false} onChange={() => {}} />],
    ['ProductStoryShowcase (vòng cung, chip bước)', () => <ProductStoryShowcase product={storyProduct} previewConfig={storyConfig} />],
    ['StoryReelStrip (vòng Story)', () => <StoryReelStrip items={[{ slug: 'a', name: 'A', thumbnail: null, seen: false }, { slug: 'b', name: 'B', thumbnail: null, seen: true }]} onOpen={() => {}} />],
    ['FreeshipAddonRail (nút + Thêm)', () => <FreeshipAddonRail items={[{ slug: 'a', name: 'A', thumbnail: null, price: 49000, variationId: 'v' }]} onAdd={() => {}} />],
    ['CartVoucherHintStrip (nút Áp dụng ngay)', () => <CartVoucherHintStrip hint={{ apply: { code: 'A', label: 'A', saving: 1000, text: 'B', ariaLabel: 'C' }, unlock: null }} onApply={() => {}} />],
    ['Switch có nhãn', () => <Switch label="A" checked={false} onChange={() => {}} />],
    ['CouponRemovedNotice (nút Đóng lời báo mã đã gỡ)', () => <CouponRemovedNotice notice={{ code: 'A', text: 'B' }} onDismiss={() => {}} />],
    ['OrderTimelineTracker (nút Sao chép thông tin đơn)', () => <OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING')} shareText="Đơn hàng Tubu Tree A" />],
    ['AffiliateFeaturedProducts (nút Chép link giới thiệu)', () => <AffiliateFeaturedProducts products={featured} />],
    ['AffiliateFeaturedProducts lỗi (nút Thử lại)', () => <AffiliateFeaturedProducts products={null} error onRetry={() => {}} />],
  ];

  it.each(cases)('%s', (_name, ui) => {
    const { container } = render(ui());
    const els = interactiveIn(container);
    expect(els.length).toBeGreaterThan(0);
    for (const el of els) {
      // ZaUI vẽ input checkbox/radio/switch đè lên ô gốc; vùng chạm là khối hitArea bọc ngoài.
      expect(reaches44(el), `${el.tagName} ${el.className} không đạt 44x44`).toBe(true);
    }
  });

  it('ProductStoryShowcase Reel (đóng, thêm giỏ · giá, câu chuyện kế)', () => {
    render(<ProductStoryShowcase product={storyProduct} previewConfig={storyConfig} fullscreen reel addPrice="49.000đ" position="1/8" onNext={() => {}} />);
    const els = interactiveIn(document.body);
    expect(els.map((el) => el.getAttribute('data-testid'))).toEqual(expect.arrayContaining(['story-close', 'story-add-to-cart', 'story-next']));
    for (const el of els) expect(reaches44(el), `${el.tagName} ${el.className} không đạt 44x44`).toBe(true);
  });

  it('ProductStoryShowcase toàn màn (đóng, thêm giỏ, mua ngay)', () => {
    // Khung toàn màn vẽ qua portal vào body nên không nằm trong container của render.
    render(<ProductStoryShowcase product={storyProduct} previewConfig={storyConfig} fullscreen />);
    const els = interactiveIn(document.body);
    expect(els.length).toBeGreaterThanOrEqual(3);
    for (const el of els) expect(reaches44(el), `${el.tagName} ${el.className} không đạt 44x44`).toBe(true);
  });
});
