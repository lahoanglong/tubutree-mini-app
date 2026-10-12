// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Ns1Card, summarizeNs1 } from './ns1-card';
import { render, type Rendered } from '@/test-utils/dom';
import type { RetentionDailyRow } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const row = (date: string, ns1CohortSize: number | null, ns1RepeatCount: number | null): RetentionDailyRow => ({
  date,
  newBuyers: 0,
  activeBuyers: 0,
  ordersCount: 0,
  ordersPerBuyerMtd: 0,
  dauProxyRefreshToken: 0,
  dauEventBased: null,
  ns1CohortSize,
  ns1RepeatCount,
});

// C-032: NS-1 là chỉ số chính (% khách có đơn thứ 2 trong 30 ngày). Mỗi dòng snapshot mang cohort MỘT ngày nên
// gộp theo SỐ ĐẾM (không trung bình các tỉ lệ ngày: ngày 1 khách mới lặp = 100% không được nặng bằng ngày 50 khách).
describe('summarizeNs1', () => {
  it('gộp theo số đếm, bỏ dòng chưa có NS-1 (null)', () => {
    expect(summarizeNs1([row('2026-09-01', 1, 1), row('2026-09-02', 9, 1), row('2026-09-03', null, null)])).toEqual({
      cohort: 10,
      repeat: 2,
      days: 2,
      pct: 20,
    });
  });

  it('chưa dòng nào có NS-1 hoặc cohort rỗng → pct null (không chia cho 0)', () => {
    expect(summarizeNs1([])).toEqual({ cohort: 0, repeat: 0, days: 0, pct: null });
    expect(summarizeNs1([row('2026-09-01', null, null)])).toMatchObject({ pct: null, days: 0 });
    expect(summarizeNs1([row('2026-09-01', 0, 0)])).toMatchObject({ pct: null, cohort: 0, days: 1 });
  });
});

describe('Ns1Card', () => {
  const mount = (rows: RetentionDailyRow[]) => {
    const r = render(<Ns1Card rows={rows} />);
    mounted.push(r);
    return r.container;
  };

  it('hiện % theo định dạng vi-VN (dấu phẩy), số khách lặp/cohort, cảnh báo mẫu nhỏ', () => {
    const c = mount([row('2026-09-01', 7, 3)]);
    expect(c.textContent).toContain('42,9%');
    expect(c.textContent).toContain('3/7 khách');
    expect(c.textContent).toMatch(/mẫu còn nhỏ/i);
  });

  it('cohort đủ lớn (>= 30 khách) → không cảnh báo mẫu nhỏ', () => {
    const c = mount([row('2026-09-01', 40, 10)]);
    expect(c.textContent).toContain('25%');
    expect(c.textContent).not.toMatch(/mẫu còn nhỏ/i);
  });

  it('chưa có dữ liệu → hiện "—" kèm giải thích, không hiện 0%', () => {
    const c = mount([row('2026-09-01', null, null)]);
    expect(c.textContent).toContain('—');
    expect(c.textContent).not.toContain('0%');
    expect(c.textContent).toMatch(/chưa có/i);
  });
});
