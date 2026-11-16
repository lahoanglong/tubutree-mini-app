import { describe, expect, it } from 'vitest';
import { GIFT_ATTACH_MIN_NET_GOODS_VND, RECYCLE_FUNNEL_STEPS, type LaunchWatchFraud } from '@tubutree/shared-types';
import {
  GIFT_PER_ACCOUNT_AMBER_AT,
  STEP_LABELS,
  WINDOW_OPTIONS,
  formatCount,
  formatPct,
  formatUpdatedAt,
  fraudAlerts,
  funnelWithPct,
  metricLevel,
  ratioPct,
  stepLabel,
} from './launch-watch-format';

const okFraud = (): LaunchWatchFraud => ({
  unverifiedPhone: { totalRequests: 10, requests: 4, users: 2, pointsAwarded: 35 },
  zeroGift: { attached: 3, accounts: 2, maxPerAccount: 2, ordersOverOne: 0, ordersBelowMin: 0, countedSince: '2026-11-16T08:17:00.000Z' },
  freeShipRecycle: { orders: 1, users: 1, totalOrders: 5, shareOfOrdersPct: 20, withConfirmedWaste: 1 },
});

describe('nhãn bước phễu và cửa sổ', () => {
  it('có nhãn tiếng Việt cho mọi bước của RECYCLE_FUNNEL_STEPS, không trùng nhau, không để lộ khoá kỹ thuật', () => {
    const labels = RECYCLE_FUNNEL_STEPS.map((s) => STEP_LABELS[s]);
    expect(labels.every((l) => l.trim().length > 0 && !/[a-z]+_[a-z]+/.test(l))).toBe(true);
    expect(new Set(labels).size).toBe(RECYCLE_FUNNEL_STEPS.length);
    expect(Object.keys(STEP_LABELS).sort()).toEqual([...RECYCLE_FUNNEL_STEPS].sort());
  });

  it('bước lạ trả lại chính khoá thay vì ném lỗi', () => {
    expect(stepLabel('enter')).toBe('Vào màn Đổi rác');
    expect(stepLabel('buoc_moi')).toBe('buoc_moi');
  });

  it('ba cửa sổ theo thứ tự 72 giờ, 7 ngày, 30 ngày', () => {
    expect(WINDOW_OPTIONS.map((o) => [o.key, o.label])).toEqual([
      ['h72', '72 giờ'],
      ['d7', '7 ngày'],
      ['d30', '30 ngày'],
    ]);
  });
});

describe('định dạng số', () => {
  it('formatCount: dấu chấm ngăn nghìn, số nhỏ giữ nguyên', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1234)).toBe('1.234');
    expect(formatCount(1234567)).toBe('1.234.567');
  });

  it('formatPct: một chữ số thập phân dấu phẩy, bỏ ",0", null hoặc không hữu hạn thì "—"', () => {
    expect(formatPct(42.857)).toBe('42,9%');
    expect(formatPct(60)).toBe('60%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(null)).toBe('—');
    expect(formatPct(Number.NaN)).toBe('—');
  });

  it('ratioPct: làm tròn một chữ số, mẫu số 0 thì null', () => {
    expect(ratioPct(1, 3)).toBe(33.3);
    expect(ratioPct(2, 3)).toBe(66.7);
    expect(ratioPct(0, 5)).toBe(0);
    expect(ratioPct(3, 0)).toBeNull();
  });

  it('formatUpdatedAt: HH:mm theo giờ Việt Nam; rỗng hoặc sai thì "—"', () => {
    expect(formatUpdatedAt('2026-11-16T07:05:00.000Z')).toBe('14:05');
    expect(formatUpdatedAt('2026-11-16T17:30:00.000Z')).toBe('00:30');
    expect(formatUpdatedAt(null)).toBe('—');
    expect(formatUpdatedAt('khong-phai-ngay')).toBe('—');
  });
});

describe('funnelWithPct', () => {
  it('% so với bước vào tính trên cột Tổng, bước vào là 100%, đủ mọi bước theo thứ tự', () => {
    const rows = funnelWithPct([
      { step: 'enter', web: 6, miniapp: 5, total: 8 },
      { step: 'submitted', web: 2, miniapp: 2, total: 3 },
    ]);
    expect(rows.map((r) => r.step)).toEqual([...RECYCLE_FUNNEL_STEPS]);
    expect(rows[0]).toMatchObject({ step: 'enter', label: 'Vào màn Đổi rác', pctOfEnter: 100 });
    expect(rows.find((r) => r.step === 'submitted')).toMatchObject({ total: 3, pctOfEnter: 37.5 });
    expect(rows.find((r) => r.step === 'geo_denied')).toMatchObject({ web: 0, miniapp: 0, total: 0, pctOfEnter: 0 });
  });

  it('chưa ai vào màn (enter = 0) thì mọi % là null, không chia cho 0', () => {
    const rows = funnelWithPct([{ step: 'enter', web: 0, miniapp: 0, total: 0 }, { step: 'submitted', web: 1, miniapp: 0, total: 1 }]);
    expect(rows.every((r) => r.pctOfEnter === null)).toBe(true);
  });

  it('danh sách rỗng vẫn trả đủ bước với % null', () => {
    const rows = funnelWithPct([]);
    expect(rows).toHaveLength(RECYCLE_FUNNEL_STEPS.length);
    expect(rows.every((r) => r.total === 0 && r.pctOfEnter === null)).toBe(true);
  });
});

describe('fraudAlerts', () => {
  it('mọi chỉ số đúng kỳ vọng thì không có cảnh báo', () => {
    expect(fraudAlerts(okFraud())).toEqual([]);
  });

  it('vi phạm bất biến báo ĐỎ: đơn quá 1 quà, đơn dưới mức tối thiểu', () => {
    const f = okFraud();
    f.zeroGift.ordersOverOne = 1;
    f.zeroGift.ordersBelowMin = 2;
    const alerts = fraudAlerts(f);
    expect(alerts.map((a) => [a.metric, a.level])).toEqual([
      ['giftOrdersOverOne', 'red'],
      ['giftOrdersBelowMin', 'red'],
    ]);
    expect(alerts[0]!.message).toContain('1 đơn mang hơn 1 quà 0đ');
    expect(alerts[1]!.message).toContain(`${String(GIFT_ATTACH_MIN_NET_GOODS_VND).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`);
  });

  it('một tài khoản nhận từ 3 quà trở lên báo VÀNG, 2 quà thì không', () => {
    expect(GIFT_PER_ACCOUNT_AMBER_AT).toBe(3);
    const two = okFraud();
    two.zeroGift.maxPerAccount = 2;
    expect(fraudAlerts(two)).toEqual([]);
    const three = okFraud();
    three.zeroGift.maxPerAccount = 3;
    const alerts = fraudAlerts(three);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ metric: 'giftMaxPerAccount', level: 'amber' });
  });

  it('metricLevel: chỉ số không có cảnh báo là ok; đỏ và vàng cùng có thì mỗi chỉ số giữ mức riêng', () => {
    const f = okFraud();
    f.zeroGift.maxPerAccount = 4;
    f.zeroGift.ordersOverOne = 1;
    const alerts = fraudAlerts(f);
    expect(metricLevel(alerts, 'giftMaxPerAccount')).toBe('amber');
    expect(metricLevel(alerts, 'giftOrdersOverOne')).toBe('red');
    expect(metricLevel(alerts, 'giftOrdersBelowMin')).toBe('ok');
  });

  it('SĐT chưa xác thực và điểm đã cộng chỉ để theo dõi: dù nhiều đến đâu cũng không báo động (mở Đổi rác chỉ cần có SĐT)', () => {
    const f = okFraud();
    f.unverifiedPhone = { totalRequests: 100, requests: 100, users: 80, pointsAwarded: 99_999 };
    expect(fraudAlerts(f)).toEqual([]);
  });

  it('đơn miễn ship kèm rác không bao giờ tự báo động (chỉ theo dõi)', () => {
    const f = okFraud();
    f.freeShipRecycle = { orders: 50, users: 40, totalOrders: 50, shareOfOrdersPct: 100, withConfirmedWaste: 0 };
    expect(fraudAlerts(f)).toEqual([]);
  });
});
