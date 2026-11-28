import { describe, expect, it } from 'vitest';
import { MARKETPLACE_SCAN_COPY, marketplaceScanSteps, scanGuideCollapsed, scanSuccessCtaLabel } from './marketplace-scan-guide';

describe('marketplaceScanSteps', () => {
  it('bước 2 đọc tỉ lệ từ cấu hình, không ghi cứng', () => {
    expect(marketplaceScanSteps(5)).toEqual([
      'Quét mã vận đơn Shopee, TikTok, Lazada',
      'Tích 5% giá trị đơn thành Điểm Xanh',
      'Dùng giảm thẳng khi mua trên Mini App, Web',
    ]);
    expect(marketplaceScanSteps(1)[1]).toBe('Tích 1% giá trị đơn thành Điểm Xanh');
    expect(marketplaceScanSteps(2.5)[1]).toBe('Tích 2,5% giá trị đơn thành Điểm Xanh');
  });

  it('chưa có cấu hình hay số hỏng: không hứa con số', () => {
    for (const bad of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(marketplaceScanSteps(bad)[1]).toBe(MARKETPLACE_SCAN_COPY.step2Plain);
    }
  });

  it('mỗi bước gọn một dòng ở 375px (≤ 44 ký tự)', () => {
    for (const s of marketplaceScanSteps(12.5)) expect(s.length, s).toBeLessThanOrEqual(44);
  });
});

describe('scanSuccessCtaLabel', () => {
  it('có điểm dùng được: nói đúng số ĐANG CÓ (khác "đang chờ cộng" của đơn vừa quét), số kiểu Việt', () => {
    expect(scanSuccessCtaLabel(1200)).toBe('Dùng 1.200 Điểm Xanh đang có');
    expect(scanSuccessCtaLabel(1.9)).toBe('Dùng 1 Điểm Xanh đang có');
    expect(scanSuccessCtaLabel(1200, 'web')).toBe('Dùng 1.200 Điểm Xanh đang có');
  });

  it('không dùng chữ "chờ" hay "mua ngay" để khỏi lẫn với điểm vừa quét còn chờ cộng', () => {
    expect(MARKETPLACE_SCAN_COPY.ctaUsePoints).not.toMatch(/chờ|mua ngay/i);
  });

  it('gọn một dòng nút ở 375px: ≤ 32 ký tự kể cả 99.999 điểm', () => {
    expect(scanSuccessCtaLabel(99_999).length).toBeLessThanOrEqual(32);
    expect(scanSuccessCtaLabel(0).length).toBeLessThanOrEqual(32);
  });

  it('chưa có điểm hoặc chưa biết số dư: "Dùng điểm mua lần sau" (w55-01), cùng chữ ở Mini và web, không hứa số điểm', () => {
    for (const n of [0, -5, null, undefined, Number.NaN]) {
      expect(scanSuccessCtaLabel(n)).toBe('Dùng điểm mua lần sau');
      expect(scanSuccessCtaLabel(n, 'web')).toBe('Dùng điểm mua lần sau');
    }
  });
});

describe('MARKETPLACE_SCAN_COPY: web và Mini App đều gửi mã được (W44)', () => {
  it('câu "sắp mở" của web nhắc cả web lẫn Zalo, không bảo chỉ làm trong Mini App', () => {
    expect(MARKETPLACE_SCAN_COPY.webSoonBody).toContain('trên web');
    expect(MARKETPLACE_SCAN_COPY.webSoonBody).toContain('Zalo');
    expect(Object.keys(MARKETPLACE_SCAN_COPY)).not.toContain('webWhy');
  });
});

describe('scanGuideCollapsed (W46)', () => {
  it('lịch sử rỗng: mở đủ 3 bước cho khách mới', () => {
    expect(scanGuideCollapsed({ meta: { total: 0 }, searching: [] })).toBe(false);
  });
  it('đã có đơn, có mã đang tìm hay lịch sử chưa về: gập một dòng', () => {
    expect(scanGuideCollapsed({ meta: { total: 2 }, searching: [] })).toBe(true);
    expect(scanGuideCollapsed({ meta: { total: 0 }, searching: [{}] })).toBe(true);
    expect(scanGuideCollapsed(undefined)).toBe(true);
  });
  it('dòng gập ngắn, không thuật ngữ cấm', () => {
    expect(MARKETPLACE_SCAN_COPY.guideToggle).toBe('Hướng dẫn quét mã');
  });
});
