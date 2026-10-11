import { describe, it, expect } from 'vitest';
import {
  formatRatePct,
  formatPoints,
  formatXu,
  formatVndShort,
  formatMultiplier,
  formatNumber,
  formatDrops,
  formatDate,
  formatDateTime,
  formatVnd,
} from './format';

// Seed lưu baseRate dạng phân số: Shopee 0.035, Lazada 0.042, TikTok 0.049.
describe('formatRatePct — tỉ lệ hoàn tiền (DB lưu phân số, hiển thị phần trăm)', () => {
  it('0.035 → "3,5%" (KHÔNG phải "0.035%")', () => {
    expect(formatRatePct(0.035)).toBe('3,5%');
  });

  it('nhận cả chuỗi (Decimal serialize thành string qua API)', () => {
    expect(formatRatePct('0.042')).toBe('4,2%');
  });

  it('số tròn → bỏ phần thập phân: 0.05 → "5%"', () => {
    expect(formatRatePct(0.05)).toBe('5%');
  });

  it('0 / null / undefined / rác → "0%" (không hiện NaN%)', () => {
    expect(formatRatePct(0)).toBe('0%');
    expect(formatRatePct(null)).toBe('0%');
    expect(formatRatePct(undefined)).toBe('0%');
    expect(formatRatePct('abc')).toBe('0%');
  });
});

// Trước đây mỗi màn tự format điểm một kiểu: "1.250 điểm" (Ví), "1250 Điểm Xanh" (Điểm Xanh),
// "1250" (Cá nhân) — cùng một con số trông như ba giá trị khác nhau.
describe('formatPoints — điểm Xanh hiển thị thống nhất', () => {
  it('luôn có dấu phân cách nghìn + đơn vị', () => {
    expect(formatPoints(1250)).toBe('1.250 điểm');
  });

  it('số nhỏ vẫn giữ đúng định dạng', () => {
    expect(formatPoints(5)).toBe('5 điểm');
  });

  it('null/undefined/rác → 0 điểm, không ra NaN', () => {
    expect(formatPoints(null)).toBe('0 điểm');
    expect(formatPoints(undefined)).toBe('0 điểm');
    expect(formatPoints(Number('x'))).toBe('0 điểm');
  });
});

// Trước đây formatXu bị định nghĩa lặp ở milestone-copy.ts và wallet.tsx — gộp về đây (A4-10).
describe('formatXu — TubuXu hiển thị thống nhất', () => {
  it('luôn có dấu phân cách nghìn + đơn vị "xu"', () => {
    expect(formatXu(50_000)).toBe('50.000 xu');
  });

  it('null/undefined/rác → 0 xu, không ra NaN', () => {
    expect(formatXu(null)).toBe('0 xu');
    expect(formatXu(undefined)).toBe('0 xu');
    expect(formatXu(Number('x'))).toBe('0 xu');
  });
});

// Mốc rút tối thiểu và hệ số Ví Tubu đến từ config BE — FE chỉ định dạng lại, không bịa số.
describe('formatVndShort — số tiền rút gọn trong câu chữ', () => {
  it('50000 → "50k"', () => {
    expect(formatVndShort(50_000)).toBe('50k');
  });

  it('1500000 → "1,5tr" (dấu phẩy thập phân kiểu Việt)', () => {
    expect(formatVndShort(1_500_000)).toBe('1,5tr');
  });

  it('2000000 → "2tr" (bỏ ",0" thừa)', () => {
    expect(formatVndShort(2_000_000)).toBe('2tr');
  });

  it('số lẻ không tròn nghìn giữ nguyên dạng đầy đủ để không nói sai con số', () => {
    expect(formatVndShort(50_500)).toBe('50.500đ');
  });

  it('null/0 → "0đ"', () => {
    expect(formatVndShort(null)).toBe('0đ');
    expect(formatVndShort(0)).toBe('0đ');
  });
});

describe('formatMultiplier — hệ số nhân', () => {
  it('1.5 → "1,5"', () => {
    expect(formatMultiplier(1.5)).toBe('1,5');
  });

  it('2 → "2" (không có ",00")', () => {
    expect(formatMultiplier(2)).toBe('2');
  });

  it('1.25 → "1,25"', () => {
    expect(formatMultiplier(1.25)).toBe('1,25');
  });

  it('thiếu config → "1" (không nhân sai lên)', () => {
    expect(formatMultiplier(undefined)).toBe('1');
  });
});

// Game/Home/Chi tiết đơn từng in số trần ("1250000", "89000") cạnh "65.000 xu" — cùng một kiểu số mà
// mỗi màn một dáng (C-083). Mọi số hiển thị đi qua helper dùng chung.
describe('formatNumber — số có dấu phân cách nghìn kiểu Việt', () => {
  it('1250000 → "1.250.000", số nhỏ giữ nguyên', () => {
    expect(formatNumber(1_250_000)).toBe('1.250.000');
    expect(formatNumber(89_000)).toBe('89.000');
    expect(formatNumber(999)).toBe('999');
  });

  it('null/undefined/rác/vô cực → "0", không ra NaN', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber(Number('x'))).toBe('0');
    expect(formatNumber(Infinity)).toBe('0');
  });

  it('nhận cả chuỗi số (Decimal serialize qua API)', () => {
    expect(formatNumber('65000' as unknown as number)).toBe('65.000');
  });
});

describe('formatVnd — cùng đường định dạng với formatNumber', () => {
  it('289000 → "289.000đ"', () => {
    expect(formatVnd(289_000)).toBe('289.000đ');
  });

  it('rác → "0đ" (không in "NaNđ")', () => {
    expect(formatVnd(Number('x'))).toBe('0đ');
    expect(formatVnd(null as unknown as number)).toBe('0đ');
  });
});

describe('formatDrops — giọt nước 💧 của Vườn Xanh', () => {
  it('có dấu nghìn + biểu tượng giọt nước', () => {
    expect(formatDrops(1250)).toBe('1.250💧');
    expect(formatDrops(20)).toBe('20💧');
  });

  it('rác → "0💧"', () => {
    expect(formatDrops(undefined)).toBe('0💧');
  });
});

// toLocale*String('vi-VN') phụ thuộc phiên bản ICU của webview ("15-10" thay vì "15/10" trên Node 24),
// nên ngày giờ tự ghép để mọi máy ra cùng một chuỗi.
describe('formatDate / formatDateTime — ngày giờ theo giờ máy, không phụ thuộc ICU', () => {
  const d = new Date(2026, 9, 5, 7, 4, 9); // 05/10/2026 07:04:09 giờ địa phương

  it('formatDate → dd/MM/yyyy', () => {
    expect(formatDate(d)).toBe('05/10/2026');
    expect(formatDate(d.toISOString())).toBe('05/10/2026');
  });

  it('formatDateTime → HH:mm dd/MM/yyyy (bỏ giây)', () => {
    expect(formatDateTime(d)).toBe('07:04 05/10/2026');
  });

  it('rỗng / ngày hỏng → "—", không in "Invalid Date"', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('không phải ngày')).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });
});
