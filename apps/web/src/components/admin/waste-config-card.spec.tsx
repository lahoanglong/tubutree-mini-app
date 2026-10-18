// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { expectNoBannedCopy } from '@/test-utils/fixtures/waste-admin';
import type { ConfigRow } from '@/lib/admin-client';
import { WASTE_CONFIG_FIELDS, WasteConfigCard } from './waste-config-card';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const ROWS: ConfigRow[] = [
  { key: 'waste.enabled', value: false, description: null, category: 'waste' },
  { key: 'waste.mailin_min_points', value: 15_000, description: null, category: 'waste' },
  { key: 'waste.customer_monthly_cap_points', value: 60_000, description: null, category: 'waste' },
  { key: 'waste.alert_thresholds', value: { quotaPacePct: 60, quotaPaceDays: 10 }, description: null, category: 'waste' },
];
const LOYALTY: ConfigRow[] = [
  { key: 'loyalty.vnd_per_point_redeem', value: 1, description: null, category: 'loyalty' },
  { key: 'loyalty.point_expire_months', value: 12, description: null, category: 'loyalty' },
  { key: 'loyalty.max_redeem_pct', value: 0.2, description: null, category: 'loyalty' },
];

const KEYS = [
  'waste.enabled',
  'waste.lane_dropoff_enabled',
  'waste.lane_mailin_enabled',
  'waste.lane_pickup_enabled',
  'waste.mailin_min_points',
  'waste.pickup_min_points',
  'waste.customer_monthly_cap_points',
  'waste.max_open_requests',
  'waste.request_hold_days',
  'waste.pickup_wait_days',
  'waste.in_transit_review_days',
  'waste.mailin_max_weight_kg',
  'waste.mailin_max_edge_cm',
  'waste.shortfall_lock_pct',
  'waste.shortfall_lock_streak',
  'waste.staff_daily_cap_points',
  'waste.gift_claim_days',
  'waste.point_inactive_days',
  'waste.mailin_fee_table',
  'waste.alert_thresholds',
  'waste.rules_text',
];

function mount() {
  const puts: { key: string; value: unknown }[] = [];
  const api = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return { body: { ok: true } };
    },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<WasteConfigCard rows={ROWS} loyaltyRows={LOYALTY} />);
  mounted.push(r);
  return { puts, c: r.container };
}

const field = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-config-key="${key}"]`)!;
const save = (c: HTMLElement, key: string) => byText(field(c, key), 'button', 'Lưu') as HTMLButtonElement;

describe('WasteConfigCard', () => {
  it('đủ 21 khoá waste.* theo thứ tự 11.5', () => {
    expect(WASTE_CONFIG_FIELDS).toHaveLength(21);
    expect(WASTE_CONFIG_FIELDS.map((f) => f.key)).toEqual(KEYS);
    const { c } = mount();
    for (const k of KEYS) expect(field(c, k), k).not.toBeNull();
  });

  it('khoá chưa seed hiện mặc định của 11.5', () => {
    const { c } = mount();
    expect(field(c, 'waste.max_open_requests').querySelector<HTMLInputElement>('input')!.value).toBe('3');
    expect(field(c, 'waste.lane_pickup_enabled').querySelector<HTMLInputElement>('input[role="switch"]')!.checked).toBe(false);
    expect(field(c, 'waste.lane_mailin_enabled').querySelector<HTMLInputElement>('input[role="switch"]')!.checked).toBe(true);
  });

  it('sửa số: hỏi xác nhận trước → sau rồi mới PUT', async () => {
    const { c, puts } = mount();
    typeInto(field(c, 'waste.customer_monthly_cap_points').querySelector('input'), '80000');
    click(save(c, 'waste.customer_monthly_cap_points'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('waste.customer_monthly_cap_points');
    expect(confirmDialog()?.textContent).toContain('60000 → 80000');
    answerConfirm(false);
    await flush();
    expect(puts).toEqual([]);
    click(save(c, 'waste.customer_monthly_cap_points'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([{ key: 'waste.customer_monthly_cap_points', value: 80_000 }]);
  });

  it('số ngoài biên bị chặn', () => {
    const { c } = mount();
    typeInto(field(c, 'waste.staff_daily_cap_points').querySelector('input'), '20000001');
    expect(field(c, 'waste.staff_daily_cap_points').textContent).toContain('Giá trị từ 1 tới 20.000.000');
    expect(save(c, 'waste.staff_daily_cap_points').disabled).toBe(true);
    typeInto(field(c, 'waste.in_transit_review_days').querySelector('input'), '6');
    expect(field(c, 'waste.in_transit_review_days').textContent).toContain('Giá trị từ 7 tới 180');
  });

  it('gói gửi kho tối thiểu lớn hơn trần điểm tháng thì cảnh báo (11.5)', () => {
    const { c } = mount();
    typeInto(field(c, 'waste.mailin_min_points').querySelector('input'), '70000');
    expect(c.textContent).toContain('Gói gửi kho tối thiểu lớn hơn trần điểm tháng: đường gửi kho sẽ đóng với mọi khách.');
  });

  it('gói thu kèm đơn tối thiểu lớn hơn trần điểm tháng thì cảnh báo (11.5)', () => {
    const { c } = mount();
    typeInto(field(c, 'waste.pickup_min_points').querySelector('input'), '70000');
    expect(c.textContent).toContain('Gói thu kèm đơn tối thiểu lớn hơn trần điểm tháng: đường thu kèm đơn sẽ đóng với mọi khách.');
  });

  it('bật tắt cách giao cũng hỏi xác nhận', async () => {
    const { c, puts } = mount();
    click(field(c, 'waste.lane_pickup_enabled').querySelector('input[role="switch"]'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('false → true');
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([{ key: 'waste.lane_pickup_enabled', value: true }]);
  });

  it('khoá JSON: JSON sai thì không gửi', () => {
    const { c } = mount();
    typeInto(field(c, 'waste.alert_thresholds').querySelector('textarea'), '{ sai');
    expect(field(c, 'waste.alert_thresholds').textContent).toContain('JSON không hợp lệ');
    expect(save(c, 'waste.alert_thresholds').disabled).toBe(true);
  });

  it('khoá JSON hợp lệ gửi giá trị đã parse sau xác nhận', async () => {
    const { c, puts } = mount();
    typeInto(field(c, 'waste.alert_thresholds').querySelector('textarea'), '{"quotaPacePct":70,"quotaPaceDays":10}');
    click(save(c, 'waste.alert_thresholds'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([{ key: 'waste.alert_thresholds', value: { quotaPacePct: 70, quotaPaceDays: 10 } }]);
  });

  it('thể lệ tối đa 8000 ký tự', async () => {
    const { c, puts } = mount();
    typeInto(field(c, 'waste.rules_text').querySelector('textarea'), 'a'.repeat(8001));
    expect(field(c, 'waste.rules_text').textContent).toContain('Thể lệ tối đa 8000 ký tự');
    expect(save(c, 'waste.rules_text').disabled).toBe(true);
    typeInto(field(c, 'waste.rules_text').querySelector('textarea'), 'Thể lệ đợt 1');
    click(save(c, 'waste.rules_text'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([{ key: 'waste.rules_text', value: 'Thể lệ đợt 1' }]);
  });

  it('giá trị cố định của Điểm Xanh chỉ để xem', () => {
    const { c } = mount();
    const fixed = c.querySelector('[data-points-fixed]')!;
    expect(fixed.textContent).toContain('1 điểm = 1đ');
    expect(fixed.textContent).toContain('Hạn điểm 12 tháng');
    expect(fixed.textContent).toContain('Dùng tối đa 20% giá trị đơn');
    expect(fixed.querySelector('input, textarea, button')).toBeNull();
  });

  it('không có chữ cấm', () => {
    const { c } = mount();
    expectNoBannedCopy(c.textContent);
  });
});
