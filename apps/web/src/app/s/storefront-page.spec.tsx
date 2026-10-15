// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const api = vi.hoisted(() => ({ storefront: null as unknown, tracker: [] as unknown[] }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getStorefront: async () => api.storefront,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, status: 'unauthenticated', initialized: true }) }));
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
});
