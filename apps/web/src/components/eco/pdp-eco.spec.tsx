// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  selectedId: null as string | null,
  passport: null as Record<string, unknown> | null,
  calls: [] as string[],
  track: vi.fn(),
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/components/pdp-selection', () => ({ usePdpSelection: () => ({ selectedId: state.selectedId }) }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: (...a: unknown[]) => state.track(...a) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (!state.passport) throw new Error('404');
      return state.passport;
    },
  },
}));

import { PdpEco } from './pdp-eco';

const SRC = 'https://www.pannature.org/bao-cao';
const FACTS = [
  { kind: 'REFILL_PACK', variationId: null, valueGrams: null, baselineText: null, label: null, co2Grams: null, sourceUrl: SRC },
  { kind: 'PLASTIC_AVOIDED', variationId: 'v10l', valueGrams: 1180, baselineText: 'so với 20 chai 500ml cùng loại', label: null, co2Grams: null, sourceUrl: SRC },
];
const PASSPORT = {
  firstOrderAt: null,
  plasticAvoidedGrams: 0,
  refillPacks: 0,
  wasteReturned: { requests: 0, grams: 0, unitsWithoutWeight: 0 },
  trees: { pledged: 0, planted: 0 },
  co2Grams: null,
  monthly: [],
  stamps: [],
};

let mounted: Rendered[] = [];
const mount = async (facts: unknown = FACTS) => {
  const r = render(<PdpEco facts={facts} productSlug="nuoc-giat-refill" />);
  mounted.push(r);
  await flush(6);
  return r.container;
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.selectedId = null;
  state.passport = null;
  state.calls = [];
  state.track.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('PdpEco (web)', () => {
  it('cờ tắt hay chưa có sự thật: không có khối, không hỏi hộ chiếu, không gửi sự kiện', async () => {
    for (const facts of [null, []]) {
      const c = await mount(facts);
      expect(c.querySelector('[data-testid="pdp-eco"]')).toBeNull();
    }
    expect(state.calls).toEqual([]);
    expect(state.track).not.toHaveBeenCalled();
  });

  it('dòng theo phân loại đang chọn; link nguồn mở tab mới, có tên miền và lời báo cho trình đọc', async () => {
    let c = await mount();
    expect(c.querySelectorAll('[data-testid="pdp-eco"] li')).toHaveLength(1);
    expect(c.querySelector('[data-testid="pdp-eco-compare"]')).toBeNull();

    state.selectedId = 'v10l';
    c = await mount();
    const items = c.querySelectorAll('[data-testid="pdp-eco"] li');
    expect(items).toHaveLength(2);
    const a = items[0]!.querySelector('a')!;
    expect(a.getAttribute('href')).toBe(SRC);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(a.textContent).toBe('Nguồn: pannature.org, mở trang mới');
    const cmp = c.querySelector('[data-testid="pdp-eco-compare"]');
    expect(cmp?.textContent).toContain('Bớt ~1,2 kg nhựa (ước tính)');
    expect(cmp?.textContent).toContain('≈ 20 chai');
  });

  it('không có IntersectionObserver: gửi eco_badge_opened một lần với loại đầu', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    await mount();
    expect(state.track).toHaveBeenCalledTimes(1);
    expect(state.track).toHaveBeenCalledWith('eco_badge_opened', { productSlug: 'nuoc-giat-refill', kind: 'REFILL_PACK' });
  });

  it('có IntersectionObserver: chỉ gửi khi khối lọt vào màn hình, một lần', async () => {
    let fire: (hit: boolean) => void = () => undefined;
    class IO {
      private off = false;
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
        fire = (hit) => {
          if (!this.off) cb([{ isIntersecting: hit }]);
        };
      }
      observe() {}
      disconnect() {
        this.off = true;
      }
    }
    vi.stubGlobal('IntersectionObserver', IO);
    await mount();
    expect(state.track).not.toHaveBeenCalled();
    fire(false);
    expect(state.track).not.toHaveBeenCalled();
    fire(true);
    fire(true);
    expect(state.track).toHaveBeenCalledTimes(1);
  });

  it('dòng Hộ chiếu Xanh chỉ khi đã đăng nhập và API trả hộ chiếu (cờ tắt: 404, không có dòng)', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    let c = await mount();
    expect(c.querySelector('[data-testid="pdp-eco-passport"]')).toBeNull();
    expect(state.calls).toEqual(['/me/eco-passport']);

    state.passport = PASSPORT;
    c = await mount();
    expect(c.querySelector('[data-testid="pdp-eco-passport"]')?.getAttribute('href')).toBe('/tai-khoan/ho-chieu-xanh');

    state.phase = 'guest';
    state.calls = [];
    c = await mount();
    expect(c.querySelector('[data-testid="pdp-eco-passport"]')).toBeNull();
    expect(state.calls).toEqual([]);
  });
});
