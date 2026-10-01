import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./analytics', () => ({ trackEvent: vi.fn() }));

import { trackEvent } from './analytics';
import { trackFilterApplied, trackSearchPerformed, trackSearchResultClicked } from './discovery-events';

const track = trackEvent as unknown as ReturnType<typeof vi.fn>;

describe('discovery-events (spec §3.4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('search_performed giữ đúng props cũ { q, resultsCount }', () => {
    trackSearchPerformed({ q: 'nuoc', resultsCount: 3 });
    expect(track).toHaveBeenCalledWith('search_performed', 'miniapp', { q: 'nuoc', resultsCount: 3 });
  });

  it('search_result_clicked { q, position, source, slug }', () => {
    trackSearchResultClicked({ q: 'nuoc', position: 2, source: 'results', slug: 'nrc' });
    expect(track).toHaveBeenCalledWith('search_result_clicked', 'miniapp', { q: 'nuoc', position: 2, source: 'results', slug: 'nrc' });
  });

  it('filter_applied { type }', () => {
    trackFilterApplied('in_stock');
    expect(track).toHaveBeenCalledWith('filter_applied', 'miniapp', { type: 'in_stock' });
  });
});
