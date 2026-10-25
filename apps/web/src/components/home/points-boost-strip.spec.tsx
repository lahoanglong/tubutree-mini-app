// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { PointsBoostStrip } from './points-boost-strip';

const BASE = { freeshipThreshold: 1, subscribeDiscountPct: 0.1, affiliateWalletMultiplier: 1, cashbackHoldDays: 1 };
let loyalty: unknown;
let mounted: Rendered | null = null;
const mount = async (omitPlain = false) => {
  mounted = render(<PointsBoostStrip omitPlain={omitPlain} />);
  await flush(6);
  return mounted.container;
};

beforeEach(() => {
  loyalty = { earnPct: 2, marketplaceEarnPct: 1, marketplaceClaimEnabled: true, vndPerPoint: 50, vndPerPointRedeem: 1000 };
  mocks.get.mockReset().mockImplementation(async () => ({ ...BASE, loyalty }));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('PointsBoostStrip (dải tăng điểm ở Trang chủ)', () => {
  it('đơn sàn bật và Tubu cao hơn đúng gấp đôi → "tích gấp đôi" kèm hai mức', async () => {
    const text = (await mount()).querySelector('[data-testid="points-boost"]')!.textContent!;
    expect(text).toContain('tích gấp đôi');
    expect(text).toContain('Đơn sàn 1%');
    expect(text).toContain('từ 2%');
  });

  it('cao hơn nhưng không gấp đôi → "tích nhiều hơn"', async () => {
    loyalty = { earnPct: 3, marketplaceEarnPct: 2, marketplaceClaimEnabled: true, vndPerPoint: 50, vndPerPointRedeem: 1000 };
    expect((await mount()).querySelector('[data-testid="points-boost"]')!.textContent).toContain('tích nhiều hơn');
  });

  it('cờ tích đơn sàn tắt → chỉ nói mức tích của đơn Tubu; omitPlain thì không nói (khối Quà khách mới đã có dòng này)', async () => {
    loyalty = { earnPct: 2, marketplaceClaimEnabled: false, vndPerPoint: 50, vndPerPointRedeem: 1000 };
    expect((await mount()).querySelector('[data-testid="points-boost"]')!.textContent).toBe('Tích 2% tiền hàng thành Điểm Xanh khi mua tại Tubu Tree');
    mounted!.unmount();
    expect((await mount(true)).querySelector('[data-testid="points-boost"]')).toBeNull();
  });

  it('chưa có cấu hình hoặc không có mức tích → không vẽ gì (không hiện số mặc định)', async () => {
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    expect((await mount()).textContent).toBe('');
    mounted!.unmount();
    mocks.get.mockImplementation(async () => ({ ...BASE }));
    expect((await mount()).textContent).toBe('');
  });
});
