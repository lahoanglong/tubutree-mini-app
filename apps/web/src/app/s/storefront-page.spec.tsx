// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const api = vi.hoisted(() => ({ storefront: null as unknown, tracker: [] as unknown[] }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getStorefront: async () => api.storefront,
}));
const auth = vi.hoisted(() => ({ user: null as null | { referralCode: string } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: auth.user, status: auth.user ? 'authenticated' : 'unauthenticated', initialized: true }) }));
vi.mock('@/components/storefront-tracker', () => ({
  StorefrontTracker: (props: unknown) => {
    api.tracker.push(props);
    return null;
  },
  ReferralCapture: () => null,
}));

import StorefrontPage from './[slug]/page';

const SF = {
  id: 's1',
  slug: 'ctvone1',
  subdomain: 'greenshop',
  type: 'CTV',
  title: 'Green Shop',
  referralCode: 'CTVONE1',
  warehouseAddress: '1 Lê Lợi',
  warehouseCity: 'TP.HCM',
  warehousePhone: '0912345678',
  collections: [],
};

let mounted: Rendered | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  api.tracker = [];
  auth.user = null;
});

describe('/s/[slug] — gian hàng mở qua subdomain', () => {
  it('SELLER-4: ghi nhớ slug gốc và mã giới thiệu của chủ do API trả, không dùng subdomain trên URL', async () => {
    api.storefront = SF;
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(api.tracker).toContainEqual({ slug: 'ctvone1', type: 'CTV', referralCode: 'CTVONE1' });
  });

  it('SELLER-8: gian hàng CTV không hiện "Kho xuất hàng"/hotline cũ; gian hàng tự giao thì hiện', async () => {
    api.storefront = SF;
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(mounted.container.textContent).not.toContain('Kho xuất hàng');
    expect(mounted.container.textContent).not.toContain('0912345678');
    mounted.unmount();
    api.storefront = { ...SF, type: 'MERCHANT', referralCode: null };
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(mounted.container.textContent).toContain('Kho xuất hàng: 1 Lê Lợi, TP.HCM');
    expect(mounted.container.textContent).toContain('0912345678');
  });

  it('CTV của đại lý (isPartner=true) hiện kho xuất hàng và hotline; isPartner=false thì ẩn', async () => {
    api.storefront = { ...SF, isPartner: true };
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(mounted.container.textContent).toContain('Kho xuất hàng: 1 Lê Lợi, TP.HCM');
    expect(mounted.container.textContent).toContain('0912345678');
    mounted.unmount();
    api.storefront = { ...SF, isPartner: false };
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(mounted.container.textContent).not.toContain('Kho xuất hàng');
    expect(mounted.container.textContent).not.toContain('0912345678');
  });

  const ITEM = {
    id: 'i1',
    note: 'Mình dùng 3 tháng, da đỡ khô hẳn.',
    variationId: null,
    product: { id: 'p1', name: 'Xà phòng cỏ', slug: 'xa-phong-co', thumbnail: null, brand: 'Tubu', basePrice: 50000, salePrice: null, ratingAvg: 4.5, reviewCount: 3, inStock: true },
  };
  const COL = { id: 'c1', title: 'Bếp xanh', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, items: [ITEM] };

  it('chủ gian hàng (mã giới thiệu khớp, không phân biệt hoa thường) thấy nút Chia sẻ gian hàng thay cho Xem sản phẩm', async () => {
    api.storefront = { ...SF, collections: [COL] };
    auth.user = { referralCode: 'ctvone1' };
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(Array.from(mounted.container.querySelectorAll('button')).some((x) => x.textContent === 'Chia sẻ gian hàng')).toBe(true);
    expect(mounted.container.textContent).not.toContain('Xem sản phẩm');
  });

  it('khách và người khác không thấy nút của chủ', async () => {
    api.storefront = { ...SF, collections: [COL] };
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(mounted.container.textContent).not.toContain('Chia sẻ gian hàng');
    mounted.unmount();
    auth.user = { referralCode: 'KHAC99' };
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(mounted.container.textContent).not.toContain('Chia sẻ gian hàng');
  });

  it('gian hàng không có sản phẩm khách xem được: khách thấy lối Xem sản phẩm, chủ thấy lời nhắn thêm sản phẩm', async () => {
    api.storefront = { ...SF, collections: [{ ...COL, items: [] }] };
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(mounted.container.textContent).toContain('Gian hàng chưa có sản phẩm nào để xem');
    expect(mounted.container.textContent).toContain('Xem sản phẩm');
    expect(mounted.container.querySelector('h2')?.textContent).not.toContain('Bếp xanh');
    mounted.unmount();
    auth.user = { referralCode: 'CTVONE1' };
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(mounted.container.textContent).toContain('Gian hàng của bạn chưa có sản phẩm nào khách xem được');
    expect(Array.from(mounted.container.querySelectorAll('a')).some((x) => x.getAttribute('href') === '/ctv/gian-hang')).toBe(true);
  });

  it('hiện lý do giới thiệu của chủ dưới sản phẩm và huy hiệu bậc', async () => {
    api.storefront = { ...SF, collections: [COL], ownerTier: { name: 'Cây Con', emoji: '🌿' } };
    mounted = render(await StorefrontPage({ params: Promise.resolve({ slug: 'greenshop' }) }));
    expect(mounted.container.textContent).toContain('Mình dùng 3 tháng, da đỡ khô hẳn.');
    expect(mounted.container.textContent).toContain('Cây Con');
  });
});
