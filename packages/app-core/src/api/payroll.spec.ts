import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { adjustPayroll, recomputePayroll } from './payroll';

describe('payroll: hợp đồng gọi API quản trị', () => {
  it('adjustPayroll gửi đúng thân DTO (số dương = trừ, số âm = thưởng) và chỉ thêm allowDuplicate khi được yêu cầu', async () => {
    const { http, calls } = fakeHttp(() => ({ adjusted: true }));
    await adjustPayroll(http, {
      staffId: 's1',
      workDate: '2026-10-19',
      amount: 50_000,
      reason: 'Đi trễ',
    });
    await adjustPayroll(http, {
      staffId: 's1',
      workDate: '2026-10-19',
      amount: -100_000,
      reason: 'Thưởng ca tối',
      allowDuplicate: true,
    });
    expect(calls).toEqual([
      {
        method: 'post',
        path: '/admin/payroll/adjust',
        body: { staffId: 's1', workDate: '2026-10-19', amount: 50_000, reason: 'Đi trễ' },
      },
      {
        method: 'post',
        path: '/admin/payroll/adjust',
        body: {
          staffId: 's1',
          workDate: '2026-10-19',
          amount: -100_000,
          reason: 'Thưởng ca tối',
          allowDuplicate: true,
        },
      },
    ]);
  });

  it('recomputePayroll truyền năm/tháng trên query; chỉ thêm reprice=1 khi quản lý cố ý định giá lại', async () => {
    const { http, calls } = fakeHttp();
    await recomputePayroll(http, 's1', 2026, 10);
    await recomputePayroll(http, 's1', 2026, 10, { reprice: true });
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['post', '/admin/payroll/s1/recompute?year=2026&month=10'],
      ['post', '/admin/payroll/s1/recompute?year=2026&month=10&reprice=1'],
    ]);
  });
});
