import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Dòng freeship và chỗ giữ hàng Ưu đãi phải có ngay trong HTML server (khi phiên chưa biết), không chèn thêm sau hydrate.
const auth = vi.hoisted(() => ({ phase: 'loading' as string }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => auth.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'idle', initialized: false, sessionUnavailable: false, user: null }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => ({}), post: vi.fn() } }));
vi.mock('@/lib/shop-client', () => ({ getCart: async () => ({}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

import { PdpCoupons, PdpFreeship } from './pdp-extras';

const html = (ui: React.ReactElement) => renderToString(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const CONFIG = { freeshipThreshold: 350_000, subscribeDiscountPct: 0.12, affiliateWalletMultiplier: 1.5, cashbackHoldDays: 30, waste: { enabled: false, dropoff: false, mailin: false, pickup: false }, shippingEta: null };

describe('PdpFreeship: HTML server', () => {
  it('đang tải phiên + config server tải sẵn: dòng có trong HTML với ngưỡng thật, giấu chữ chỉ khi <html> có data-restoring', () => {
    const out = html(<PdpFreeship initialConfig={CONFIG} />);
    expect(out).toContain('data-testid="pdp-freeship"');
    expect(out).toContain('350.000');
    expect(out.replaceAll('&amp;', '&')).toContain('[html[data-restoring]_&]:invisible');
  });
  it('khách vãng lai: chữ hiện hẳn, không giấu', () => {
    auth.phase = 'guest';
    const out = html(<PdpFreeship initialConfig={CONFIG} />);
    expect(out).toContain('350.000');
    expect(out).not.toContain('invisible');
    auth.phase = 'loading';
  });
  it('đã đăng nhập mà giỏ chưa về: giữ chỗ một dòng nhưng giấu chữ và khỏi trình đọc màn hình', () => {
    auth.phase = 'authenticated';
    const out = html(<PdpFreeship initialConfig={CONFIG} />);
    expect(out).toContain('data-testid="pdp-freeship"');
    expect(out).toContain('invisible');
    expect(out).toContain('aria-hidden="true"');
    auth.phase = 'loading';
  });
});

describe('PdpCoupons: chỗ giữ 44px khi đang khôi phục phiên', () => {
  const product = { slug: 's', basePrice: 100_000, variations: [{ id: 'v', retailPrice: 100_000 }] };
  it('đang tải phiên: có ô giữ chỗ chỉ hiện khi data-restoring; phiên khác thì không dựng gì', () => {
    const out = html(<PdpCoupons productId="p" product={product} />);
    expect(out).toContain('data-testid="pdp-offers-slot"');
    expect(out).toContain('h-11');
    auth.phase = 'guest';
    expect(html(<PdpCoupons productId="p" product={product} />)).not.toContain('pdp-offers-slot');
    auth.phase = 'loading';
  });
});
