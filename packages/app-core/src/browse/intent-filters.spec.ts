import { describe, expect, it } from 'vitest';
import {
  INTENT_FILTERS, changedIntentFilters, intentFilterChips, intentFilterCount, intentFilterQuery, offeredIntentFilters, parseIntentFilters, writeIntentFilters,
} from './intent-filters';

describe('intent-filters ("Đang ưu đãi", "Có bản Refill")', () => {
  it('nhãn và tên sự kiện cố định, "Đang ưu đãi" đứng trước', () => {
    expect(INTENT_FILTERS.map((f) => [f.key, f.label, f.event])).toEqual([
      ['onSale', 'Đang ưu đãi', 'on_sale'],
      ['hasRefill', 'Có bản Refill', 'has_refill'],
    ]);
  });

  it('URL: chỉ "1" là bật; ghi lại theo thứ tự cố định, bỏ bộ lọc tắt (một trạng thái một URL)', () => {
    expect(parseIntentFilters(new URLSearchParams('hasRefill=1&onSale=1'))).toEqual({ onSale: true, hasRefill: true });
    expect(parseIntentFilters(new URLSearchParams('onSale=true&hasRefill=0'))).toEqual({});
    const p = new URLSearchParams();
    writeIntentFilters({ hasRefill: true, onSale: true }, p);
    expect(p.toString()).toBe('onSale=1&hasRefill=1');
    const off = new URLSearchParams();
    writeIntentFilters({ onSale: false }, off);
    expect(off.toString()).toBe('');
  });

  it('tham số API, số đếm badge, bộ lọc đổi và chip gỡ được', () => {
    expect(intentFilterQuery({ onSale: true, hasRefill: false })).toEqual({ onSale: true });
    expect(intentFilterCount({ onSale: true, hasRefill: true })).toBe(2);
    expect(intentFilterCount({})).toBe(0);
    expect(changedIntentFilters({ onSale: true }, { hasRefill: true }).map((f) => f.event)).toEqual(['on_sale', 'has_refill']);
    expect(changedIntentFilters({ onSale: true }, { onSale: true, hasRefill: false })).toEqual([]);
    expect(intentFilterChips({ hasRefill: true, onSale: true })).toEqual([
      { key: 'onSale', label: 'Đang ưu đãi', patch: { onSale: false } },
      { key: 'hasRefill', label: 'Có bản Refill', patch: { hasRefill: false } },
    ]);
  });

  it('"Có bản Refill" chỉ mời khi cờ Refill bật, hoặc khi link đang mang sẵn bộ lọc đó (khách bỏ chọn được)', () => {
    expect(offeredIntentFilters(true).map((f) => f.key)).toEqual(['onSale', 'hasRefill']);
    expect(offeredIntentFilters(false).map((f) => f.key)).toEqual(['onSale']);
    expect(offeredIntentFilters(false, { hasRefill: true }).map((f) => f.key)).toEqual(['onSale', 'hasRefill']);
  });
});
