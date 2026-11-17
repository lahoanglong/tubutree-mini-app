import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));

import { trackEvent } from '../../services/analytics';
import { PdpEco } from './pdp-eco';

const SRC = 'https://www.pannature.org/bao-cao';
const FACTS = [
  { kind: 'REFILL_PACK', variationId: null, valueGrams: null, baselineText: null, label: null, co2Grams: null, sourceUrl: SRC },
  { kind: 'PLASTIC_AVOIDED', variationId: 'v10l', valueGrams: 1180, baselineText: 'so với 20 chai 500ml cùng loại', label: null, co2Grams: null, sourceUrl: SRC },
];

beforeEach(() => vi.mocked(trackEvent).mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('PdpEco (Mini)', () => {
  it('cờ tắt hay chưa có sự thật: không có khối, không gửi sự kiện', () => {
    for (const facts of [undefined, null, []]) {
      const { container, unmount } = render(<PdpEco facts={facts} variationId="v1" productSlug="sp" />);
      expect(container.querySelector('[data-testid="pdp-eco"]')).toBeNull();
      unmount();
    }
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('dòng theo phân loại đang chọn; nguồn là chữ tên miền, không có link (webview Zalo chặn link ngoài)', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<PdpEco facts={FACTS} variationId="v10l" productSlug="nuoc-giat-refill" />);
    const items = container.querySelectorAll('[data-testid="pdp-eco"] li');
    expect(items).toHaveLength(2);
    expect(items[1]!.textContent).toContain('Giảm khoảng 1,2 kg nhựa mỗi món, so với 20 chai 500ml cùng loại (ước tính)');
    expect(items[0]!.textContent).toContain('Nguồn: pannature.org');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).not.toContain('Hộ chiếu');
  });

  it('gửi eco_badge_opened một lần mỗi sản phẩm khi khối lọt vào màn hình', () => {
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
    const { rerender } = render(<PdpEco facts={FACTS} variationId={null} productSlug="nuoc-giat-refill" />);
    expect(trackEvent).not.toHaveBeenCalled();
    fire(true);
    expect(trackEvent).toHaveBeenCalledWith('eco_badge_opened', 'miniapp', { productSlug: 'nuoc-giat-refill', kind: 'REFILL_PACK' });
    rerender(<PdpEco facts={FACTS} variationId="v10l" productSlug="nuoc-giat-refill" />);
    fire(true);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });
});
