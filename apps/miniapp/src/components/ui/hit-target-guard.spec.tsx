import { render } from '@testing-library/react';
import type { ProductDetail } from '@tubutree/app-core/api/catalog';
import { featuredAffiliateProducts } from '@tubutree/app-core/commerce/affiliate-share';
import { buildOrderTimelineSteps } from '@tubutree/app-core/commerce/order-timeline';
import { productTrustStrip } from '@tubutree/app-core/commerce/product-trust-strip';
import { Search } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { AffiliateFeaturedProducts } from '../affiliate/featured-products';
import { OrderTimelineTracker } from '../orders/order-timeline-tracker';
import { OrderTrackingPill } from '../orders/order-tracking-pill';
import { Button } from './button';
import { Chip } from './chip';
import { Checkbox, Radio, Switch } from './form';
import { Input } from './input';
import SnackbarProvider, { useSnackbar } from '../../build-snackbar-shim';
import { useEffect } from 'react';
import { IconButton } from './icon-button';
import { ListRow } from './list-row';
import { CouponRemovedNotice } from '../checkout/coupon-removed-notice';
import { QuantitySelector } from './quantity-selector';
import { ProductStoryShowcase } from './product-story-showcase';
import { SegmentedTabs } from './segmented-tabs';
import { StoryReelStrip } from './story-reel-strip';
import { FreeshipAddonRail } from './freeship-addon-rail';
import { FreeShippingProgressBar } from './free-shipping-progress-bar';
import { CartVoucherHintStrip } from './cart-voucher-hint-strip';
import { FrequentlyBoughtTogether } from './frequently-bought-together';
import { QuickReorderStrip } from './quick-reorder-strip';
import { ProductTrustStrip } from './product-trust-strip';
import { LoyaltyRulesCard } from '../loyalty/loyalty-rules-card';
import { GiftTrialRow } from '../checkout/gift-rows';
import { PdpRebuyRow } from '../product/pdp-rebuy';
import { PdpRefillOffer } from '../product/pdp-refill-offer';
import { PdpOriginGuide } from '../product/pdp-origin-guide';
import { pdpOriginView } from '@tubutree/app-core/commerce/pdp-origin';
import { pdpRefillOffer } from '@tubutree/app-core/refill/refill-saving';
import { SubscriptionSuggestionRow } from '../reorder/subscription-suggestion';
import { RefillNextDelivery } from '../refill/refill-next-delivery';
import { useAuthStore } from '../../store/auth';
import { MemoryRouter } from 'react-router-dom';
import { LinkBuilderSheet } from '../affiliate/link-builder-sheet';

// `SectionHeader` (tiêu đề của dải) gọi useNavigate của ZaUI, cần router thật; vùng chạm không phụ thuộc nó.
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => vi.fn() }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));

/**
 * Vùng chạm >= 44x44 (C-021, WCAG 2.5.5) cho mọi phần tử bấm được mà DS v2 dựng. jsdom không có layout,
 * nên đọc kích thước KHAI BÁO: width/height/min* >= 44 trên chính phần tử hoặc cha bọc ngay trên nó,
 * hoặc lớp `tubu-hit-44*` (pseudo-element 44px), `touch-target` (min 44x44 trong tokens.css). Component mới thêm vào danh sách này sẽ bị bắt nếu quên.
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
  // `tubu-input`: ô nhập DS cao 48px, rộng theo khối (tokens.css, `input.spec.tsx` canh chiều cao).
  if (/\btubu-hit-44(-square)?\b|\btouch-target\b|\btubu-input\b/.test(el.className)) return true;
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

function OpenToast() {
  const { openSnackbar } = useSnackbar();
  useEffect(() => openSnackbar({ text: 'Đã thêm', action: { text: 'Xem giỏ', close: true } }), []);
  return null;
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
    ['FreeShippingProgressBar (nút Mua thêm)', () => <FreeShippingProgressBar base={50_000} threshold={200_000} onShopMore={() => {}} />],
    // W166: dải chỉ còn nút "Mua thêm" (mã dùng được không sinh nút "Áp dụng ngay" ở dải nữa); vùng chạm của nút "Áp dụng" ở hàng mã chân dính do cart.spec và e2e giỏ giữ.
    ['CartVoucherHintStrip (có mã dùng được + sắp mở khoá: chỉ nút Mua thêm)', () => <CartVoucherHintStrip hint={{ apply: { code: 'A', label: 'A', saving: 1000, text: 'B', ariaLabel: 'C' }, unlock: { code: 'A', missing: 1000, pct: 90, text: 'B', barAria: 'C' } }} onShopMore={() => {}} />],
    ['CartVoucherHintStrip (nút Mua thêm)', () => <CartVoucherHintStrip hint={{ apply: null, unlock: { code: 'A', missing: 1000, pct: 90, text: 'B', barAria: 'C' } }} onShopMore={() => {}} />],
    ['ProductTrustStrip (lối xem chính sách)', () => <ProductTrustStrip view={productTrustStrip({ fulfillerKind: 'TUBU', returnWindowDays: 7 })} onOpenPolicy={() => {}} />],
    ['FrequentlyBoughtTogether (dòng tick, nút Thêm)', () => (
      <FrequentlyBoughtTogether
        lines={[{ key: 'a', productId: 'p', slug: 'a', variationId: 'a', name: 'A', thumbnail: null, price: 49000, compareAt: null, isCurrent: true }]}
        picked={new Set(['a'])}
        summary={{ count: 1, bundleTotal: 49000, bundleOriginalTotal: 49000, bundleSavings: 0 }}
        onToggle={() => {}}
        onAdd={() => {}}
      />
    )],
    ['Switch có nhãn', () => <Switch label="A" checked={false} onChange={() => {}} />],
    ['Input có nhãn', () => <Input label="A" />],
    ['Hộp thông báo có nút hành động', () => <SnackbarProvider><OpenToast /></SnackbarProvider>],
    ['CouponRemovedNotice (nút Đóng lời báo mã đã gỡ)', () => <CouponRemovedNotice notice={{ code: 'A', text: 'B' }} onDismiss={() => {}} />],
    ['OrderTimelineTracker (nút Sao chép thông tin đơn)', () => <OrderTimelineTracker steps={buildOrderTimelineSteps('SHIPPING')} shareText="Đơn hàng Tubu Tree A" />],
    ['OrderTrackingPill (viên vận đơn, chạm chép mã)', () => <OrderTrackingPill code="GHN123" partner="Giao Hàng Nhanh" />],
    // Khối có bảng nội dung bán hàng (useQuery) nên cần QueryClient; bảng đóng thì không gọi API.
    ['AffiliateFeaturedProducts (nút Chép link, Ảnh + Bài mẫu)', () => (
      <QueryClientProvider client={new QueryClient()}>
        <AffiliateFeaturedProducts products={featured} />
      </QueryClientProvider>
    )],
    ['AffiliateFeaturedProducts lỗi (nút Thử lại)', () => (
      <QueryClientProvider client={new QueryClient()}>
        <AffiliateFeaturedProducts products={null} error onRetry={() => {}} />
      </QueryClientProvider>
    )],
    ['LoyaltyRulesCard (nút gập Cách kiếm và dùng Điểm Xanh)', () => <LoyaltyRulesCard lines={['A']} />],
    ['PdpRebuyRow (nút Mua lại)', () => (
      <PdpRebuyRow
        dateLabel="03/11"
        variationName="500ml"
        busy={false}
        blocked={false}
        onRebuy={() => {}}
      />
    )],
    ['PdpOriginGuide (dòng gập/mở Nguồn gốc & cách dùng, lối bản đồ)', () => (
      <PdpOriginGuide view={pdpOriginView({ brand: 'Tubu Tree', name: 'Nước giặt Fuwa3e', description: 'Bảo quản: nơi khô ráo' }, { originChip: false })} onOpenMap={() => {}} />
    )],
    ['PdpRefillOffer (mở trang gói Refill, nút + Thêm)', () => (
      <PdpRefillOffer
        view={pdpRefillOffer({ name: 'Nước rửa chén 500ml', price: 68_000 }, {
          productId: 'p-refill', slug: 'refill-a', name: 'Túi Refill 10L', thumbnail: null, variationId: 'v-refill',
          price: 890_000, compareAt: null, sizeLabel: '10L', inStock: true, tubu: true,
        })!}
        busy={false}
        onAdd={() => {}}
        onOpen={() => {}}
      />
    )],
    ['GiftTrialRow (nút Đổi quà tặng dùng thử 0đ)', () => (
      <GiftTrialRow
        summary={{
          base: 320_000,
          minOrder: 299_000,
          nextMinOrder: null,
          shortfall: 0,
          options: [{ variationId: 'g', productName: 'Khăn giấy tre', variationName: 'Gói bỏ túi', slug: 'k', thumbnail: null, minOrder: 299_000, unlocked: true }],
          selectedVariationId: 'g',
          declined: false,
        }}
        showLocked
        onChoose={() => {}}
      />
    )],
    ['SubscriptionSuggestionRow (dòng gợi ý giao định kỳ)', () => (
      <SubscriptionSuggestionRow
        suggestion={{ variationId: 'v', productName: 'Nước giặt', variationName: 'Can 3,8L', slug: 'n', thumbnail: null, unitPrice: 189_000, intervalWeeks: 6, lastDeliveredAt: '2026-11-01T00:00:00.000Z' }}
        discountFraction={0.12}
        onAccept={() => {}}
      />
    )],
    ['RefillNextDelivery (Quản lý gói định kỳ, Dời lịch kỳ tới)', () => {
      // Thẻ chỉ vẽ cho khách đã đăng nhập có gói Refill đang chạy: dựng sẵn danh sách gói, không tải lại (staleTime vô hạn).
      useAuthStore.setState({ status: 'authenticated' });
      const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      qc.setQueryData(['subscriptions'], [
        {
          id: 's', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: new Date(Date.now() + 10 * 864e5).toISOString(), productName: 'Túi Refill 3L',
          variationName: 'Túi 3L', thumbnail: null, slug: 'refill-a', unitPrice: 189_000, effectiveDiscountPct: 0.12,
        },
      ]);
      const landing = {
        enabled: true,
        pairs: [{
          bottle: { productId: 'b', slug: 'chai-a', name: 'Chai', thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true },
          refill: { productId: 'r', slug: 'refill-a', name: 'Túi Refill 3L', thumbnail: null, variationId: 'v', price: 189_000, compareAt: null, sizeLabel: '3L', inStock: true, tubu: true },
          savingPct: 20,
        }],
      };
      return (
        <MemoryRouter>
          <QueryClientProvider client={qc}>
            <RefillNextDelivery landing={landing} />
          </QueryClientProvider>
        </MemoryRouter>
      );
    }],
  ];

  it.each(cases)('%s', (_name, ui) => {
    const status = useAuthStore.getState().status;
    const { container } = render(ui());
    useAuthStore.setState({ status });
    const els = interactiveIn(container);
    expect(els.length).toBeGreaterThan(0);
    for (const el of els) {
      // ZaUI vẽ input checkbox/radio/switch đè lên ô gốc; vùng chạm là khối hitArea bọc ngoài.
      expect(reaches44(el), `${el.tagName} ${el.className} không đạt 44x44`).toBe(true);
    }
  });

  it('QuickReorderStrip: thân thẻ và "+ Thêm" đạt 44x44; "Thêm lại tất cả" của tiêu đề khai minHeight 44', () => {
    const item = (id: string) => ({ key: id, productId: `p-${id}`, slug: id, variationId: id, name: id.toUpperCase(), thumbnail: null, price: 49000, compareAt: null, savePct: 0, isFlash: false, timesBought: 2, source: 'purchased' as const });
    const { container } = render(<QuickReorderStrip items={[item('a'), item('b')]} onAdd={() => {}} onAddAll={() => {}} onOpen={() => {}} />);
    const header = container.querySelector('[data-testid="section-header"]')!;
    const headerButtons = Array.from(header.querySelectorAll<HTMLElement>('button'));
    expect(headerButtons).toHaveLength(1);
    // Chiều cao của hàng tiêu đề là token `--section-header-h` (44px) mà jsdom không đọc được; nút tự khai minHeight 44. Bề ngang do nhãn quyết định (đo thật ở e2e).
    expect(px(headerButtons[0]!.style.minHeight)).toBeGreaterThanOrEqual(44);
    const own = interactiveIn(container).filter((el) => !header.contains(el));
    expect(own.map((el) => el.getAttribute('data-testid') ?? 'tubu-quick-open')).toEqual(['tubu-quick-open', 'quick-reorder-add', 'tubu-quick-open', 'quick-reorder-add']);
    for (const el of own) expect(reaches44(el), `${el.tagName} ${el.className} không đạt 44x44`).toBe(true);
  });

  it('ProductStoryShowcase Reel (đóng, thêm giỏ · giá, câu chuyện kế)', () => {
    render(<ProductStoryShowcase product={storyProduct} previewConfig={storyConfig} fullscreen reel addPrice="49.000đ" position="1/8" onNext={() => {}} />);
    const els = interactiveIn(document.body);
    expect(els.map((el) => el.getAttribute('data-testid'))).toEqual(expect.arrayContaining(['story-close', 'story-add-to-cart', 'story-next']));
    for (const el of els) expect(reaches44(el), `${el.tagName} ${el.className} không đạt 44x44`).toBe(true);
  });

  it('LinkBuilderSheet (tab đích, ô tìm, dòng chọn sản phẩm, nút Tạo link)', () => {
    const qc = new QueryClient();
    qc.setQueryData(['affiliate-link-picker', ''], [{ id: 'p1', name: 'Nước rửa chén', brand: 'Tubu', maxAffiliateRate: 0.1 }]);
    render(
      <QueryClientProvider client={qc}>
        <LinkBuilderSheet open onClose={() => {}} busy={false} error={null} onCreate={() => {}} />
      </QueryClientProvider>,
    );
    const els = interactiveIn(document.body);
    expect(els.filter((el) => el.getAttribute('role') === 'radio')).toHaveLength(1);
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
