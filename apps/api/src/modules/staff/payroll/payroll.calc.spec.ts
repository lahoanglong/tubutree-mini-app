import { sumWorkedMinutes, computeDayPay } from './payroll.calc';

const win = (effStart: string, effEnd: string, sessions: [string, string | null][]) => ({
  effStart: new Date(effStart),
  effEnd: new Date(effEnd),
  sessions: sessions.map(([a, b]) => ({ checkinAt: new Date(a), checkoutAt: b ? new Date(b) : null })),
});

describe('sumWorkedMinutes', () => {
  it('1 phiên trong cửa sổ', () => {
    expect(
      sumWorkedMinutes([win('2026-07-03T01:00:00Z', '2026-07-03T05:00:00Z', [['2026-07-03T01:00:00Z', '2026-07-03T03:00:00Z']])]),
    ).toBe(120);
  });

  it('checkin sớm chỉ tính từ giờ ca (cắt biên)', () => {
    expect(
      sumWorkedMinutes([win('2026-07-03T01:00:00Z', '2026-07-03T05:00:00Z', [['2026-07-03T00:30:00Z', '2026-07-03T02:00:00Z']])]),
    ).toBe(60);
  });

  it('phiên đang mở (checkout null) bỏ qua', () => {
    expect(
      sumWorkedMinutes([win('2026-07-03T01:00:00Z', '2026-07-03T05:00:00Z', [['2026-07-03T01:00:00Z', null]])]),
    ).toBe(0);
  });

  it('nhiều phiên cộng dồn (nghỉ giữa ca)', () => {
    expect(
      sumWorkedMinutes([
        win('2026-07-03T01:00:00Z', '2026-07-03T09:00:00Z', [
          ['2026-07-03T01:00:00Z', '2026-07-03T04:00:00Z'],
          ['2026-07-03T05:00:00Z', '2026-07-03T08:00:00Z'],
        ]),
      ]),
    ).toBe(360);
  });
});

describe('computeDayPay', () => {
  it('gross làm tròn theo giờ × đơn giá', () => {
    // 90 phút × 30k/h = 45k
    const r = computeDayPay(90, 30000, []);
    expect(r.gross).toBe(45000);
    expect(r.net).toBe(45000);
    expect(r.fines).toBe(0);
  });

  it('phạt (dương) trừ vào net + tính fines', () => {
    const r = computeDayPay(120, 30000, [{ amount: 10000 }]); // 60k - 10k
    expect(r.gross).toBe(60000);
    expect(r.fines).toBe(10000);
    expect(r.net).toBe(50000);
  });

  it('MANUAL âm = thưởng → tăng net, không tính vào fines', () => {
    const r = computeDayPay(60, 30000, [{ amount: -5000 }]); // 30k - (-5k) = 35k
    expect(r.gross).toBe(30000);
    expect(r.fines).toBe(0);
    expect(r.net).toBe(35000);
  });

  /**
   * Kẹp net ≥ 0 theo TỪNG NGÀY làm tiền phạt biến mất: ngày huỷ ca không có giờ công nào nên
   * gross = 0, phạt 30.000 kẹp lại thành 0 — bảng lương hiện "Phạt: 30.000" mà "Thực nhận"
   * không đổi một đồng. Nay giữ số âm ở mức NGÀY (là khoản nợ), chỉ kẹp ở mức THÁNG.
   */
  it('phạt vượt lương ngày → net ÂM (khoản nợ chuyển lên tháng), không bị nuốt mất', () => {
    const r = computeDayPay(30, 20000, [{ amount: 50000 }]); // 10k - 50k
    expect(r.net).toBe(-40000);
    expect(r.fines).toBe(50000);
  });

  it('ngày huỷ ca: không có giờ công + phạt 1h công → net = -30.000', () => {
    const r = computeDayPay(0, 30000, [{ amount: 30000 }]);
    expect(r.gross).toBe(0);
    expect(r.net).toBe(-30000);
  });

  it('rate 0 → gross 0', () => {
    expect(computeDayPay(120, 0, []).gross).toBe(0);
  });
});
