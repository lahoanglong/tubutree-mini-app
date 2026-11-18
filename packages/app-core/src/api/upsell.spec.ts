import { describe, expect, it } from 'vitest';
import { FREESHIP_UPSELL_EXCLUDE_MAX } from '@tubutree/shared-types';
import { fakeHttp } from './fake-http';
import { fetchFreeshipUpsell, freeshipUpsellParams, freeshipUpsellQueryKey } from './upsell';

describe('freeshipUpsellParams', () => {
  it('đã đạt mốc (còn thiếu ≤ 0, NaN): không hỏi', () => {
    for (const r of [0, -1, Number.NaN]) expect(freeshipUpsellParams(r, [{ slug: 'a' }])).toBeNull();
  });

  it('slug bỏ trùng và xếp lại: hai giỏ cùng món khác thứ tự dùng chung một khoá; số thiếu làm tròn lên đồng nguyên', () => {
    const a = freeshipUpsellParams(35_000.4, [{ slug: 'b' }, { slug: 'a' }, { slug: 'b' }, { slug: '' }]);
    const b = freeshipUpsellParams(35_000.4, [{ slug: 'a' }, { slug: 'b' }]);
    expect(a).toEqual({ gap: 35_001, exclude: ['a', 'b'] });
    expect(freeshipUpsellQueryKey(a!)).toEqual(freeshipUpsellQueryKey(b!));
  });

  it(`tối đa ${FREESHIP_UPSELL_EXCLUDE_MAX} slug (trần của API)`, () => {
    const lines = Array.from({ length: FREESHIP_UPSELL_EXCLUDE_MAX + 5 }, (_, i) => ({ slug: `s${String(i).padStart(2, '0')}` }));
    expect(freeshipUpsellParams(10_000, lines)!.exclude).toHaveLength(FREESHIP_UPSELL_EXCLUDE_MAX);
  });
});

describe('fetchFreeshipUpsell — đúng route', () => {
  it('GET /upsell/freeship kèm gap và exclude; giỏ không có slug thì không gửi exclude', async () => {
    const { http, calls } = fakeHttp(() => []);
    await fetchFreeshipUpsell(http, { gap: 35_000, exclude: ['a', 'b'] });
    await fetchFreeshipUpsell(http, { gap: 9_000, exclude: [] });
    expect(calls).toEqual([
      { method: 'get', path: '/upsell/freeship', opts: { query: { gap: 35_000, exclude: 'a,b' } } },
      { method: 'get', path: '/upsell/freeship', opts: { query: { gap: 9_000 } } },
    ]);
  });
});
