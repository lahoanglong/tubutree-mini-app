// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const state = vi.hoisted(() => ({
  selectedId: null as string | null,
  track: vi.fn(),
}));

vi.mock('@/components/pdp-selection', () => ({ usePdpSelection: () => ({ selectedId: state.selectedId }) }));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: (...a: unknown[]) => state.track(...a) }));

import { PdpHighlightsBlock } from './pdp-highlights-block';

const SRC = 'https://www.pannature.org/bao-cao';
const FACTS = [
  { kind: 'REFILL_PACK', variationId: null, valueGrams: null, baselineText: null, label: null, co2Grams: null, sourceUrl: SRC },
  { kind: 'PLASTIC_AVOIDED', variationId: 'v10l', valueGrams: 1180, baselineText: 'so với 20 chai 500ml cùng loại', label: null, co2Grams: null, sourceUrl: SRC },
];

let mounted: Rendered[] = [];
const mount = async (props: Partial<Parameters<typeof PdpHighlightsBlock>[0]> = {}) => {
  const r = render(<PdpHighlightsBlock benefit={null} certifications={[]} ecoFacts={FACTS} productSlug="nuoc-giat-refill" {...props} />);
  mounted.push(r);
  await flush(4);
  return r.container;
};
const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="pdp-highlights"] li'));

beforeEach(() => {
  state.selectedId = null;
  state.track.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('PdpHighlightsBlock (web, w47-01): mô tả ngắn + Điểm cộng xanh + chứng nhận thành tối đa 3 dòng', () => {
  it('không có dữ liệu (cờ nhãn xanh tắt, không mô tả ngắn, không chứng nhận): không có khối, không gửi sự kiện', async () => {
    const c = await mount({ ecoFacts: null });
    expect(c.querySelector('[data-testid="pdp-highlights"]')).toBeNull();
    expect(state.track).not.toHaveBeenCalled();
  });

  it('gộp đủ ba nguồn trong 3 dòng, thứ tự lợi ích → Điểm cộng xanh → chứng nhận; chứng nhận là một dòng chip', async () => {
    state.selectedId = 'v10l';
    vi.stubGlobal('IntersectionObserver', undefined);
    const c = await mount({ benefit: 'Sạch dầu mỡ. Không mùi hắc. Dịu da tay.', certifications: ['Ecocert', 'Vegan'] });
    const list = rows(c);
    expect(list.map((li) => li.dataset.kind)).toEqual(['benefit', 'eco', 'certs']);
    expect(list[0]!.textContent).toBe('Sạch dầu mỡ.');
    expect(Array.from(c.querySelectorAll('.tubu-highlights-cert')).map((el) => el.textContent)).toEqual(['Ecocert', 'Vegan']);
  });

  it('Điểm cộng xanh theo phân loại đang chọn; link nguồn mở tab mới, có tên miền và lời báo cho trình đọc', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    let c = await mount();
    expect(rows(c)).toHaveLength(1);

    state.selectedId = 'v10l';
    c = await mount();
    const list = rows(c);
    expect(list).toHaveLength(2);
    const a = list[0]!.querySelector('a')!;
    expect(a.getAttribute('href')).toBe(SRC);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(a.textContent).toBe('Nguồn: pannature.org, mở trang mới');
  });

  it('không có IntersectionObserver: gửi eco_badge_opened một lần với loại đầu', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    await mount();
    expect(state.track).toHaveBeenCalledTimes(1);
    expect(state.track).toHaveBeenCalledWith('eco_badge_opened', { productSlug: 'nuoc-giat-refill', kind: 'REFILL_PACK' });
  });

  it('có IntersectionObserver: chỉ gửi khi khối lọt vào màn hình, một lần; khối không có dòng xanh thì không gửi', async () => {
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

    state.track.mockReset();
    vi.stubGlobal('IntersectionObserver', undefined);
    await mount({ ecoFacts: null, benefit: 'Sạch dầu mỡ' });
    expect(state.track).not.toHaveBeenCalled();
  });
});
