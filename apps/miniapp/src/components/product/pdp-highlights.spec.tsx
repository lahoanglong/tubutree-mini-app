import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));

import { pdpHighlights } from '@tubutree/app-core/commerce/pdp-highlights';
import { ecoFactLines } from '@tubutree/app-core/eco/facts';
import { trackEvent } from '../../services/analytics';
import { PdpHighlights } from './pdp-highlights';

const SRC = 'https://www.pannature.org/bao-cao';
const FACTS = [
  { kind: 'REFILL_PACK', variationId: null, valueGrams: null, baselineText: null, label: null, co2Grams: null, sourceUrl: SRC },
  { kind: 'PLASTIC_AVOIDED', variationId: 'v10l', valueGrams: 1180, baselineText: 'so với 20 chai 500ml cùng loại', label: null, co2Grams: null, sourceUrl: SRC },
];
const rows = (variationId: string | null, benefit: string | null = null, certs: string[] = []) =>
  pdpHighlights({ benefit, certifications: certs, eco: ecoFactLines(FACTS, variationId) });

beforeEach(() => vi.mocked(trackEvent).mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('PdpHighlights (Mini)', () => {
  it('không có dòng nào: không có khối, không gửi sự kiện', () => {
    const { container } = render(<PdpHighlights rows={[]} productSlug="sp" />);
    expect(container.querySelector('[data-pdp-block="benefits"]')).toBeNull();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('một khối tối đa 3 dòng: lợi ích, Điểm cộng xanh (nguồn là chữ tên miền, không link), chứng nhận là một dòng chip', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<PdpHighlights rows={rows('v10l', 'Sạch dầu mỡ\nKhông hại da tay\nHương sả', ['Ecocert', 'Vegan'])} productSlug="nuoc-giat-refill" />);
    const block = container.querySelector('[data-pdp-block="benefits"]')!;
    expect(block.getAttribute('aria-label')).toBe('Điểm nổi bật');
    const items = block.querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect([...items].map((li) => li.getAttribute('data-kind'))).toEqual(['benefit', 'eco', 'certs']);
    expect(items[0]!.textContent).toBe('Sạch dầu mỡ');
    expect(items[1]!.textContent).toContain('Nguồn: pannature.org');
    expect(items[2]!.querySelectorAll('.tubu-highlights-cert')).toHaveLength(2);
    expect(container.querySelector('a')).toBeNull();
  });

  it('gửi eco_badge_opened một lần mỗi sản phẩm khi khối có Điểm cộng xanh lọt vào màn hình', () => {
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
    const { rerender } = render(<PdpHighlights rows={rows(null)} productSlug="nuoc-giat-refill" />);
    expect(trackEvent).not.toHaveBeenCalled();
    fire(true);
    expect(trackEvent).toHaveBeenCalledWith('eco_badge_opened', 'miniapp', { productSlug: 'nuoc-giat-refill', kind: 'REFILL_PACK' });
    rerender(<PdpHighlights rows={rows('v10l')} productSlug="nuoc-giat-refill" />);
    fire(true);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  it('không có Điểm cộng xanh: không gửi sự kiện', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<PdpHighlights rows={pdpHighlights({ benefit: 'A', certifications: [], eco: [] })} productSlug="sp" />);
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
