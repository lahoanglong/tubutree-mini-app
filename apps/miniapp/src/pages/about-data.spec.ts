import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ getPublicConfig: vi.fn() }));
vi.mock('../services/api', () => ({ api: { get: vi.fn() } }));
vi.mock('../services/shop-api', () => ({ getPublicConfig: mocks.getPublicConfig }));

import { fallbackFaq, fetchSupportContact } from './about-data';

describe('fetchSupportContact (Q-17: liên hệ đọc từ /config/public, dòng chưa có giá trị thì ẩn)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('đọc hotline/email/Zalo OA từ khoá support của /config/public', async () => {
    mocks.getPublicConfig.mockResolvedValue({
      support: { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: 'Tubu Tree', hours: ' 8:00–21:00 mỗi ngày ' },
    });
    expect(await fetchSupportContact()).toEqual({
      hotline: '0984 606 774',
      email: 'tubutree@gmail.com',
      zaloOaName: 'Tubu Tree',
      hours: '8:00–21:00 mỗi ngày',
    });
  });

  it('chuỗi toàn khoảng trắng hoặc sai kiểu coi như chưa có (null), giá trị thật được cắt khoảng trắng', async () => {
    mocks.getPublicConfig.mockResolvedValue({
      support: { hotline: '  0984 606 774 ', email: '   ', zaloOaName: 42 },
    });
    expect(await fetchSupportContact()).toEqual({ hotline: '0984 606 774', email: null, zaloOaName: null, hours: null });
  });

  it('API cũ chưa có khoá support → cả ba null, không ném lỗi', async () => {
    mocks.getPublicConfig.mockResolvedValue({ freeshipThreshold: 200000 });
    expect(await fetchSupportContact()).toEqual({ hotline: null, email: null, zaloOaName: null, hours: null });
  });
});

// \b của JS coi chữ có dấu là ký tự không phải chữ, nên "sản xuất" khớp \bxu\b; dùng ranh giới theo chữ Unicode.
const STANDALONE_XU = /(^|[^\p{L}])xu([^\p{L}]|$)/iu;

describe('fallbackFaq sau khi gộp TubuXu vào Điểm Xanh (PD-3)', () => {
  const answer = (q: RegExp, cfg?: Parameters<typeof fallbackFaq>[0]) => fallbackFaq(cfg).find((f) => q.test(f.q))?.a ?? '';

  it('câu thanh toán chỉ nêu COD, chuyển khoản, Ví Tubu và dùng Điểm Xanh để giảm giá — không còn TubuXu', () => {
    const a = answer(/thanh toán/);
    expect(a).toContain('Ví Tubu');
    expect(a).toContain('Điểm Xanh');
    expect(a).not.toMatch(/xu/i);
  });

  // D14-06: chưa có khách thật nên không có điểm quy đổi từ xu; nhắc "xu cũ" và "trừ tới 100%" chỉ làm khách mới hiểu lầm.
  it('câu Điểm Xanh không nhắc "xu" và không hứa trừ tới 100% giá trị hàng', () => {
    const a = answer(/Điểm Xanh là gì/);
    expect(a).not.toMatch(STANDALONE_XU);
    expect(a).not.toMatch(/100%/);
    expect(a).not.toMatch(/không hết hạn/);
    expect(a).toContain('Điểm có hạn');
  });

  it('không câu dự phòng nào nhắc "xu"', () => {
    for (const f of fallbackFaq()) expect(`${f.q} ${f.a}`).not.toMatch(STANDALONE_XU);
  });
});

// D5-10: bản dự phòng từng ghi cứng "10.000đ = 1 Điểm Xanh", "1.000đ", "20%", "12 tháng", "7 ngày". Admin đổi cấu hình thì
// câu trả lời nói sai; giờ số lấy từ /config/public, thiếu thì bỏ con số chứ không đoán.
describe('fallbackFaq: con số lấy từ cấu hình công khai (D5-10)', () => {
  const find = (q: RegExp, cfg?: Parameters<typeof fallbackFaq>[0]) => fallbackFaq(cfg).find((f) => q.test(f.q))?.a ?? '';
  const CFG = {
    loyalty: { earnPct: 3, vndPerPointRedeem: 1_000, maxRedeemPct: 0.3, pointExpireMonths: 6 },
    returnWindowDays: 14,
  };

  it('Điểm Xanh: mốc tích, giá trị 1 điểm, trần % và hạn điểm theo config', () => {
    const a = find(/Điểm Xanh là gì/, CFG);
    expect(a).toContain('Mỗi đơn đã giao tích 3% tiền hàng thành Điểm Xanh.');
    expect(a).toContain('1 Điểm Xanh đổi 1.000đ khi thanh toán, tối đa 30% giá trị đơn.');
    expect(a).toContain('Điểm có hạn 6 tháng.');
    expect(a).not.toMatch(/10\.000đ|20%|12 tháng/);
  });

  it('mốc khác → câu đổi theo: 5.000đ/điểm, 500đ/điểm, trần 10%, 24 tháng', () => {
    const a = find(/Điểm Xanh là gì/, { loyalty: { earnPct: 5, vndPerPointRedeem: 500, maxRedeemPct: 0.1, pointExpireMonths: 24 } });
    expect(a).toContain('Mỗi đơn đã giao tích 5% tiền hàng thành Điểm Xanh.');
    expect(a).toContain('1 Điểm Xanh đổi 500đ khi thanh toán, tối đa 10% giá trị đơn.');
    expect(a).toContain('Điểm có hạn 24 tháng.');
  });

  it('trần 0 (tắt dùng điểm thường ở thanh toán): nói điểm đổi mã giảm giá, không còn "%"', () => {
    const a = find(/Điểm Xanh là gì/, { loyalty: { ...CFG.loyalty, maxRedeemPct: 0 } });
    expect(a).toContain('1 Điểm Xanh đổi 1.000đ khi đổi mã giảm giá.');
    expect(a).not.toMatch(/tối đa \d+%/);
  });

  it('chưa có config (API cũ, đang tải, lỗi mạng): câu Điểm Xanh không có con số tiền, % hay tháng nào', () => {
    const a = find(/Điểm Xanh là gì/);
    expect(a).not.toMatch(/\d+(\.\d{3})*đ|tối đa \d+%|\d+ tháng/);
    expect(a).toContain('Điểm Xanh');
  });

  it('thiếu từng phần thì chỉ bỏ phần đó: có mốc tích nhưng chưa có hạn điểm', () => {
    const a = find(/Điểm Xanh là gì/, { loyalty: { earnPct: 3, vndPerPointRedeem: 1_000 } });
    expect(a).toContain('Mỗi đơn đã giao tích 3% tiền hàng thành Điểm Xanh.');
    expect(a).toContain('1 Điểm Xanh đổi 1.000đ khi thanh toán.');
    // "100%" của lô điểm quy đổi là luật cố định, không phải số của config.
    expect(a).not.toMatch(/\d+ tháng|tối đa \d+%/);
  });

  it('đổi/trả: số ngày theo returnWindowDays, thiếu thì không nêu số ngày', () => {
    expect(find(/đổi\/trả/, CFG)).toContain('trong vòng 14 ngày từ khi nhận');
    expect(find(/đổi\/trả/, CFG)).not.toContain('7 ngày');
    expect(find(/đổi\/trả/)).not.toMatch(/\d+ ngày/);
  });

  it.each([0, -1, Number.NaN, '7'])('số liệu hỏng (%p) coi như chưa có, không hiện "0 ngày", "NaN"', (bad) => {
    const cfg = { loyalty: { vndPerPoint: bad, vndPerPointRedeem: bad, maxRedeemPct: bad, pointExpireMonths: bad }, returnWindowDays: bad } as never;
    const text = fallbackFaq(cfg).map((f) => f.a).join(' ');
    expect(text).not.toMatch(/NaN|undefined|\b0đ|\b0 (ngày|tháng)|-1/);
  });
});
