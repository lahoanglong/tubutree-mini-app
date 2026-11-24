import { describe, expect, it } from 'vitest';
import { guestOrderMilestones } from './milestones';

const base = { createdAt: '2026-11-24T02:00:00.000Z', deliveredAt: null, statusTimes: {} as Record<string, string> };
const view = (o: Parameters<typeof guestOrderMilestones>[0]) => guestOrderMilestones(o).map((s) => [s.label, s.state, s.at]);

describe('guestOrderMilestones: mốc có giờ của /don/<mã>', () => {
  it('chuyển khoản chờ tiền: Đã đặt là mốc hiện tại kèm giờ đặt, các mốc sau chưa có giờ', () => {
    expect(view({ ...base, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' })).toEqual([
      ['Đã đặt', 'current', '2026-11-24T02:00:00.000Z'],
      ['Đã xác nhận', 'upcoming', null],
      ['Đang giao', 'upcoming', null],
      ['Hoàn tất', 'upcoming', null],
    ]);
  });

  it('COD tạo thẳng ở Đã xác nhận (sổ trạng thái không có dòng): giờ xác nhận lấy giờ đặt', () => {
    expect(view({ ...base, status: 'CONFIRMED', paymentMethod: 'COD' }).slice(0, 2)).toEqual([
      ['Đã đặt', 'completed', '2026-11-24T02:00:00.000Z'],
      ['Đã xác nhận', 'current', '2026-11-24T02:00:00.000Z'],
    ]);
  });

  it('đã giao: đủ 4 mốc đã qua, mỗi mốc một giờ từ sổ trạng thái và deliveredAt', () => {
    const o = {
      ...base,
      status: 'DELIVERED',
      paymentMethod: 'BANK_TRANSFER',
      deliveredAt: '2026-11-26T09:30:00.000Z',
      statusTimes: { CONFIRMED: '2026-11-24T02:05:00.000Z', PACKED: '2026-11-24T05:00:00.000Z', SHIPPING: '2026-11-25T01:00:00.000Z' },
    };
    expect(view(o)).toEqual([
      ['Đã đặt', 'completed', '2026-11-24T02:00:00.000Z'],
      ['Đã xác nhận', 'completed', '2026-11-24T02:05:00.000Z'],
      ['Đang giao', 'completed', '2026-11-25T01:00:00.000Z'],
      ['Hoàn tất', 'completed', '2026-11-26T09:30:00.000Z'],
    ]);
  });

  it('đơn huỷ và đơn hoàn: bước nhánh giữ tên chung kèm giờ', () => {
    const cancelled = guestOrderMilestones({ ...base, status: 'CANCELLED', paymentMethod: 'COD', statusTimes: { CANCELLED: '2026-11-24T03:00:00.000Z' } });
    expect(cancelled.map((s) => [s.key, s.label, s.at])).toEqual([
      ['received', 'Đã đặt', '2026-11-24T02:00:00.000Z'],
      ['cancelled', 'Đã huỷ', '2026-11-24T03:00:00.000Z'],
    ]);
    const returned = guestOrderMilestones({ ...base, status: 'RETURNED', paymentMethod: 'COD', statusTimes: { RETURNED: '2026-11-28T03:00:00.000Z' } });
    expect(returned.at(-1)).toMatchObject({ key: 'returned', label: 'Đã hoàn trả', state: 'cancelled', at: '2026-11-28T03:00:00.000Z' });
  });
});
