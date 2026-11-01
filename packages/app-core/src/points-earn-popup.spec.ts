import { describe, expect, it } from 'vitest';
import { POINTS_EARN_POPUP, pointsEarnPopup } from './points-earn-popup';

describe('popup Cách tính Điểm Xanh (PDP)', () => {
  it('có hạng: nói tên hạng và hệ số theo tierId, số lấy từ bảng hạng', () => {
    const p = pointsEarnPopup({ tier: { multiplier: 1.2, tierName: 'Lộc Biếc' }, guest: false, marketplace: null });
    expect(p.tier).toBe('Hạng Lộc Biếc: ×1,2');
  });

  it('khách vãng lai: hệ số ×1 và mời đăng nhập', () => {
    const p = pointsEarnPopup({ tier: { multiplier: 1, tierName: null }, guest: true, marketplace: null });
    expect(p.tier).toContain('×1');
    expect(p.tier).toContain('Đăng nhập');
  });

  it('đã đăng nhập nhưng chưa có hạng: ×1, không mời đăng nhập', () => {
    const p = pointsEarnPopup({ tier: { multiplier: 1, tierName: null }, guest: false, marketplace: null });
    expect(p.tier).toContain('×1');
    expect(p.tier).not.toContain('Đăng nhập');
  });

  it('chưa biết hạng: không đoán hệ số', () => {
    const p = pointsEarnPopup({ tier: null, guest: false, marketplace: null });
    expect(p.tier).not.toMatch(/×/);
  });

  it('giải thích dấu "~" và điểm vào khi giao thành công', () => {
    const p = pointsEarnPopup({ tier: null, guest: false, marketplace: null });
    expect(p.tilde).toMatch(/giảm giá.*mã.*điểm/);
    expect(p.delivered).toBe('Nhận Điểm Xanh khi đơn giao thành công');
  });

  it('đơn sàn: có thì nguyên câu, không thì ẩn (null)', () => {
    expect(pointsEarnPopup({ tier: null, guest: false, marketplace: 'Đơn sàn 1% · x' }).marketplace).toBe('Đơn sàn 1% · x');
    expect(pointsEarnPopup({ tier: null, guest: false, marketplace: null }).marketplace).toBeNull();
  });

  it('nhãn bấm có chữ đọc màn hình', () => {
    expect(POINTS_EARN_POPUP.rowAria).toMatch(/Điểm Xanh/);
  });
});
