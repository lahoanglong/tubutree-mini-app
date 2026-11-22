// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDTO } from '@/lib/shop-client';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Lời mời bạn ở màn Đặt hàng thành công của web (cờ growth.referral_viral_enabled), cùng Mini App (order-success-invite.spec của Mini): một dòng dưới các nút chính.

const mocks = vi.hoisted(() => ({ get: vi.fn(), track: vi.fn(), cfg: {} as Record<string, unknown> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/analytics', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/analytics')>()), trackWebEvent: mocks.track }));
vi.mock('next/link', () => ({
  default: ({ href, children, replace, ...rest }: { href: string; children: React.ReactNode; replace?: boolean }) => (
    <a href={href} data-replace={replace ? 'true' : undefined} {...rest}>{children}</a>
  ),
}));

import { OrderSuccess } from './order-success';

const ORDER = {
  id: 'o1', code: 'TB-9', status: 'CONFIRMED', subtotal: 100000, discount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0,
  paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', createdAt: '2026-10-19T00:00:00Z', items: [],
} as unknown as OrderDTO;
const CARD = (over: Record<string, unknown> = {}) => ({
  referralCode: 'LAN2026', album: null, wasteItems: 0, firstOrderReward: { points: 100, minOrderAmount: 199000 }, earnsPoints: true, ...over,
});
const greenCardCalls = () => mocks.get.mock.calls.filter((c) => c[0] === '/me/green-card');

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrderSuccess order={ORDER} etaLabel={null} continueHref="/" />);
  mounted.push(r);
  await flush(6);
  return r.container;
};

beforeEach(() => {
  mocks.cfg = { subscribeDiscountPct: 0.12, isLoaded: true, referralViralEnabled: true };
  mocks.get.mockReset().mockImplementation(async (path: string) => (path === '/me/green-card' ? CARD() : undefined));
  mocks.track.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('OrderSuccess (web): lời mời bạn sau khi đặt', () => {
  it('cờ bật, tài khoản nhận thưởng đơn đầu: một dòng mời dưới nút Theo dõi đơn ở cả khổ điện thoại và máy tính, đọc thưởng của máy chủ', async () => {
    const c = await mount();
    const mobile = c.querySelector('[data-testid="order-success-mobile"]')!;
    const row = mobile.querySelector<HTMLButtonElement>('[data-testid="order-invite-nudge"]')!;
    expect(row.tagName).toBe('BUTTON');
    expect(row.textContent).toContain('Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh');
    expect(row.textContent).toContain('Chia sẻ qua Zalo');
    const track = [...mobile.querySelectorAll('button')].find((b) => b.textContent === 'Theo dõi đơn')!;
    expect(track.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(c.querySelectorAll('[data-testid="order-invite-nudge"]')).toHaveLength(2);
    expect(greenCardCalls().length).toBeGreaterThan(0);
  });

  it('chạm: hộp chia sẻ của máy nhận lời mời thưởng và link ?ref=, ghi green_card_shared (surface order); máy không có hộp thì chép lời mời và báo', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const c = await mount();
    click(c.querySelector('[data-testid="order-invite-nudge"]')!);
    await flush(4);
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]![0]).toMatchObject({ title: 'Tubu Tree: trồng cây, nhận quà', text: 'Tặng bạn trải nghiệm thuần khiết — nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ' });
    expect(String(share.mock.calls[0]![0].url)).toContain('LAN2026');
    expect(mocks.track).toHaveBeenCalledWith('green_card_shared', { method: 'share', surface: 'order' });

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } });
    click(c.querySelector('[data-testid="order-invite-nudge"]')!);
    await flush(4);
    expect(writeText.mock.calls[0]![0]).toMatch(/LAN2026/);
    expect(c.querySelector('[data-testid="order-success-mobile"] [role="status"]')?.textContent).toBeTruthy();
  });

  it('CTV (earnsPoints false) hay 0 điểm: không có dòng mời', async () => {
    mocks.get.mockImplementation(async (path: string) => (path === '/me/green-card' ? CARD({ earnsPoints: false }) : undefined));
    let c = await mount();
    expect(c.querySelector('[data-testid="order-invite-nudge"]')).toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.get.mockImplementation(async (path: string) => (path === '/me/green-card' ? CARD({ firstOrderReward: { points: 0, minOrderAmount: 0 } }) : undefined));
    c = await mount();
    expect(c.querySelector('[data-testid="order-invite-nudge"]')).toBeNull();
  });

  it('cờ tắt hay API cũ chưa trả cờ: không gọi /me/green-card, không có dòng', async () => {
    mocks.cfg = { subscribeDiscountPct: 0.12, isLoaded: true };
    const c = await mount();
    expect(greenCardCalls()).toHaveLength(0);
    expect(c.querySelector('[data-testid="order-invite-nudge"]')).toBeNull();
  });
});
