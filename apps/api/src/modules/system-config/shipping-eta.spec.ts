import { DEFAULT_WAREHOUSE_SCHEDULE, toShippingEta, toWarehouseSchedule, warehouseScheduleProblem } from './shipping-eta';

describe('toShippingEta', () => {
  it('khoảng hợp lệ thì trả, sai thì null', () => {
    expect(toShippingEta(1, 2)).toEqual({ minDays: 1, maxDays: 2 });
    expect(toShippingEta(3, 2)).toBeNull();
    expect(toShippingEta(null, 2)).toBeNull();
  });
});

describe('lịch kho shipping.warehouse_schedule (tubu-w6-02)', () => {
  it('chưa có dòng: lịch chuẩn PO duyệt (T2–T7, cắt 15:00, TP.HCM 1–2, tỉnh 2–4 ngày làm việc)', () => {
    expect(toWarehouseSchedule(null)).toEqual({ cutoff: '15:00', workDays: [1, 2, 3, 4, 5, 6], holidays: [], hcmDays: [1, 2], provinceDays: [2, 4] });
    expect(toWarehouseSchedule(null)).toEqual(DEFAULT_WAREHOUSE_SCHEDULE);
  });

  it('trường hỏng về trường mặc định, trường đúng giữ nguyên; ngày làm khử trùng và xếp', () => {
    expect(
      toWarehouseSchedule({ cutoff: '25:00', workDays: [6, 1, 1, 3], holidays: ['2026-12-25', 'x'], hcmDays: [1, 3], provinceDays: [5, 2] }),
    ).toEqual({ cutoff: '15:00', workDays: [1, 3, 6], holidays: ['2026-12-25'], hcmDays: [1, 3], provinceDays: [2, 4] });
    expect(toWarehouseSchedule({ cutoff: '16:30', holidays: ['2026-12-25'], workDays: [] })).toMatchObject({ cutoff: '16:30', holidays: ['2026-12-25'], workDays: [1, 2, 3, 4, 5, 6] });
  });

  it('luật ghi: lịch chuẩn hợp lệ, giá trị sai báo rõ chỗ sai', () => {
    expect(warehouseScheduleProblem(DEFAULT_WAREHOUSE_SCHEDULE)).toBeNull();
    expect(warehouseScheduleProblem({ ...DEFAULT_WAREHOUSE_SCHEDULE, holidays: ['2026-01-01', '2026-04-30'] })).toBeNull();
    expect(warehouseScheduleProblem('x')).toMatch(/object/);
    expect(warehouseScheduleProblem({ ...DEFAULT_WAREHOUSE_SCHEDULE, cutoff: '3pm' })).toMatch(/cutoff/);
    expect(warehouseScheduleProblem({ ...DEFAULT_WAREHOUSE_SCHEDULE, workDays: [] })).toMatch(/workDays/);
    expect(warehouseScheduleProblem({ ...DEFAULT_WAREHOUSE_SCHEDULE, workDays: [7] })).toMatch(/workDays/);
    expect(warehouseScheduleProblem({ ...DEFAULT_WAREHOUSE_SCHEDULE, holidays: ['30/04/2026'] })).toMatch(/holidays/);
    expect(warehouseScheduleProblem({ ...DEFAULT_WAREHOUSE_SCHEDULE, holidays: ['2026-02-30'] })).toMatch(/holidays/);
    expect(warehouseScheduleProblem({ ...DEFAULT_WAREHOUSE_SCHEDULE, hcmDays: [2, 1] })).toMatch(/hcmDays/);
    expect(warehouseScheduleProblem({ ...DEFAULT_WAREHOUSE_SCHEDULE, provinceDays: [2] })).toMatch(/provinceDays/);
  });
});
