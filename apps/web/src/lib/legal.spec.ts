import { describe, expect, it } from 'vitest';
import { LEGAL_DRAFT_NOTICE, LEGAL_PAGES, LEGAL_SLUGS, defaultLegalContent, isLegalSlug } from './legal';

const VARS = { returnWindowDays: 7, freeshipThreshold: 200000 };
const SUPPORT = { hotline: '0899 149 229', email: 'tubutree@gmail.com' };

describe('legal — khung trang điều khoản/chính sách (D5-01)', () => {
  it('đúng bốn trang, theo thứ tự hiển thị ở chân trang', () => {
    expect([...LEGAL_SLUGS]).toEqual(['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen']);
    for (const slug of LEGAL_SLUGS) expect(LEGAL_PAGES[slug].title.length).toBeGreaterThan(5);
  });

  it('isLegalSlug chỉ nhận bốn mã, kể cả khi đường dẫn là tên thuộc tính của Object', () => {
    for (const ok of LEGAL_SLUGS) expect(isLegalSlug(ok)).toBe(true);
    for (const bad of ['', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'Dieu-Khoan', 'dieu-khoan/', 'admin']) {
      expect(isLegalSlug(bad)).toBe(false);
    }
  });

  it('thông báo bản nháp ghi rõ chờ Tubu Tree duyệt', () => {
    expect(LEGAL_DRAFT_NOTICE).toContain('BẢN NHÁP');
    expect(LEGAL_DRAFT_NOTICE).toContain('chờ Tubu Tree duyệt');
  });

  describe.each(LEGAL_SLUGS)('bản nháp mặc định %s', (slug) => {
    const text = defaultLegalContent(slug, VARS, SUPPORT);

    it('có nội dung đủ dài, có mục đánh số và nêu cách liên hệ lấy từ cấu hình hỗ trợ', () => {
      expect(text.length).toBeGreaterThan(600);
      expect(text).toMatch(/^## 1\./m);
      expect(text).toContain('0899 149 229');
      expect(text).toContain('tubutree@gmail.com');
    });

    it('để trống chỗ pháp nhân bằng [Tên công ty], không bịa mã số thuế hay địa chỉ', () => {
      expect(text).toContain('[Tên công ty]');
      expect(text).toMatch(/Mã số thuế: \[[^\]]+\]/);
      expect(text).toMatch(/Địa chỉ: \[[^\]]+\]/);
      expect(text).not.toMatch(/\b\d{10}(-\d{3})?\b/);
    });

    it('không để lọt chỗ trống mẫu kiểu {biến} hay undefined', () => {
      expect(text).not.toMatch(/\{[a-zA-Z]+\}|undefined|NaN|null/);
    });
  });

  it('đổi trả: số ngày và ngưỡng freeship lấy từ biến truyền vào, không cứng trong chữ', () => {
    const doiTra = defaultLegalContent('doi-tra', { returnWindowDays: 10, freeshipThreshold: 300000 }, SUPPORT);
    expect(doiTra).toContain('10 ngày');
    expect(doiTra).not.toContain('7 ngày');
    const vanChuyen = defaultLegalContent('van-chuyen', { returnWindowDays: 10, freeshipThreshold: 300000 }, SUPPORT);
    expect(vanChuyen).toContain('300.000đ');
    expect(vanChuyen).not.toContain('200.000đ');
  });

  it('đổi trả và vận chuyển dẫn chéo nhau, điều khoản dẫn tới bảo mật/đổi trả/vận chuyển bằng đường dẫn nội bộ', () => {
    const dk = defaultLegalContent('dieu-khoan', VARS, SUPPORT);
    for (const other of ['bao-mat', 'doi-tra', 'van-chuyen']) expect(dk).toContain(`](/chinh-sach/${other})`);
    expect(defaultLegalContent('doi-tra', VARS, SUPPORT)).toContain('](/chinh-sach/van-chuyen)');
  });

  it('bảo mật: chỉ hứa tự sửa họ tên trong Tài khoản (số điện thoại chỉ đọc), đổi số thì gửi yêu cầu qua liên hệ', () => {
    const text = defaultLegalContent('bao-mat', VARS, SUPPORT);
    expect(text).toContain('tự sửa họ tên trong mục Tài khoản');
    expect(text).not.toMatch(/tự sửa tên và số điện thoại/);
    expect(text).toMatch(/đổi số điện thoại[^.]*thông tin liên hệ/);
  });

  it('chỉ nêu các cách thanh toán mà trang thanh toán thật có (COD, chuyển khoản, Ví Tubu)', () => {
    const dk = defaultLegalContent('dieu-khoan', VARS, SUPPORT);
    expect(dk).toContain('thanh toán khi nhận hàng (COD)');
    expect(dk).toContain('chuyển khoản ngân hàng');
    expect(dk).toContain('Ví Tubu');
    expect(dk).not.toMatch(/Visa|MasterCard|MoMo|ZaloPay|VNPay/i);
  });
});
