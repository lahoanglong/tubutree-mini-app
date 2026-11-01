// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Bản web của components/offers/offers-points-strip.spec.tsx (Mini App): dải Điểm Xanh gọn, một nút tới trang hạng, lỗi tại chỗ.
const mocks = vi.hoisted(() => ({ push: vi.fn(), cfg: { isLoaded: true, loyalty: { vndPerPointRedeem: 1000 } } as Record<string, unknown> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', fullName: 'Lan', pointsBalance: 100, pointsConvertedBalance: 20 } }) }));

import { OffersPointsStrip, type PointsStripQuery } from './offers-points-strip';

const loaded = (over: Partial<PointsStripQuery> = {}): PointsStripQuery => ({
  data: { pointsBalance: 100, pointsConvertedBalance: 20, tier: { name: 'Mầm Xanh' }, nextTier: null } as PointsStripQuery['data'],
  isError: false,
  refetch: vi.fn(),
  ...over,
});

let mounted: Rendered | null = null;
const mount = async (loyalty: PointsStripQuery) => {
  mounted = render(<OffersPointsStrip loyalty={loyalty} />);
  await flush(4);
  return mounted.container;
};

beforeEach(() => mocks.push.mockReset());
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('OffersPointsStrip (web) — dải Điểm Xanh gọn ở trang Ưu đãi', () => {
  it('vùng tên "Điểm Xanh", hạng, nút tên đọc có hạng và số điểm, bấm tới /tai-khoan/diem-xanh', async () => {
    const c = await mount(loaded());
    expect(c.querySelector('section[aria-label*="Điểm Xanh"]')).not.toBeNull();
    expect(c.textContent).toContain('Mầm Xanh');
    const btn = c.querySelector<HTMLButtonElement>('button[aria-label$="Hạng và lịch sử điểm"]')!;
    expect(btn.getAttribute('aria-label')).toMatch(/Mầm Xanh, 120 điểm/);
    click(btn);
    expect(mocks.push).toHaveBeenCalledWith('/tai-khoan/diem-xanh');
  });

  it('lối vào chi tiết điểm chỉ có một nút (cả khối bấm được), chữ "Hạng và lịch sử điểm" hiện đúng một lần', async () => {
    const c = await mount(loaded());
    expect(c.textContent!.split('Hạng và lịch sử điểm').length - 1).toBe(1);
    expect(c.querySelectorAll('button[aria-label$="Hạng và lịch sử điểm"]')).toHaveLength(1);
  });

  it('có thanh tiến độ lên hạng kế; chưa tải được hạng thì không đoán hạng, báo lỗi và "Thử lại" gọi lại', async () => {
    const refetch = vi.fn();
    let c = await mount(loaded());
    expect(c.querySelector('[role="progressbar"][aria-label="Tiến độ lên hạng kế"]')).not.toBeNull();
    mounted!.unmount();
    c = await mount(loaded({ data: undefined, isError: true, refetch }));
    expect(c.textContent).toContain('Chưa tải được hạng và điểm');
    expect(c.textContent).not.toContain('Mầm Xanh');
    expect(c.querySelector('[role="progressbar"]')).toBeNull();
    click([...c.querySelectorAll('button')].find((b) => b.textContent === 'Thử lại')!);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
