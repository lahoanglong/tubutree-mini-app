import { describe, expect, it } from 'vitest';
import { DEFAULT_LEGAL_VARS, LEGAL_DRAFT_NOTICE, LEGAL_PAGES, LEGAL_SLUGS, defaultLegalContent, isLegalSlug } from './legal';

const VARS = { returnWindowDays: 7, freeshipThreshold: 199000 };
const SUPPORT = { hotline: '0984 606 774', email: 'tubutree@gmail.com' };

describe('DEFAULT_LEGAL_VARS (Q12)', () => {
  it('ngưỡng freeship dự phòng 199.000đ', () => {
    expect(DEFAULT_LEGAL_VARS.freeshipThreshold).toBe(199000);
  });
});

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
      expect(text).toContain('0984 606 774');
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
    // Thời gian hoàn tiền (7 ngày làm việc) là mốc cố định riêng, không phải số ngày đổi trả.
    expect(doiTra).toContain('Thời gian hoàn tiền: 7 ngày làm việc kể từ khi');
    expect(doiTra.replace('7 ngày làm việc', '')).not.toContain('7 ngày');
    const vanChuyen = defaultLegalContent('van-chuyen', { returnWindowDays: 10, freeshipThreshold: 300000 }, SUPPORT);
    expect(vanChuyen).toContain('300.000đ');
    expect(vanChuyen).not.toContain('199.000đ');
  });

  it('ngưỡng freeship 0: ghi "miễn phí vận chuyển cho mọi đơn", không in "Đơn từ 0đ" hay mốc mặc định 199.000đ', () => {
    const text = defaultLegalContent('van-chuyen', { returnWindowDays: 7, freeshipThreshold: 0 }, SUPPORT);
    expect(text).toContain('Mọi đơn đều được miễn phí vận chuyển');
    expect(text).not.toContain('Đơn từ');
    expect(text).not.toContain('0đ');
    expect(text).not.toContain('199.000đ');
    expect(text).not.toContain('ngưỡng miễn phí khác');
  });

  it('hạn đổi trả 0 ngày: nói thẳng chưa nhận đổi trả sau khi giao, không in "trong vòng 0 ngày"', () => {
    const text = defaultLegalContent('doi-tra', { returnWindowDays: 0, freeshipThreshold: 199000 }, SUPPORT);
    expect(text).not.toContain('0 ngày');
    expect(text).toContain('chưa nhận yêu cầu đổi trả sau khi giao');
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

describe('legal — đơn vị vận hành điền từ cấu hình', () => {
  const FILLED = { ...VARS, legalName: 'Công ty TNHH Tubu', taxCode: '0312345678', address: '1 Đường A, Quận B' };

  it.each(LEGAL_SLUGS)('%s: điền tên, MST, địa chỉ khi có, không còn chỗ giữ [ ] của pháp nhân', (slug) => {
    const text = defaultLegalContent(slug, FILLED, SUPPORT);
    expect(text).toContain('- Đơn vị vận hành: Công ty TNHH Tubu');
    expect(text).toContain('- Mã số thuế: 0312345678');
    expect(text).toContain('- Địa chỉ: 1 Đường A, Quận B');
    expect(text).not.toMatch(/\[(Tên công ty|Mã số thuế|Địa chỉ trụ sở)\]/);
  });

  it('điều khoản và bảo mật gọi đúng tên công ty trong câu mở đầu', () => {
    expect(defaultLegalContent('dieu-khoan', FILLED, SUPPORT)).toContain('do Công ty TNHH Tubu ("Tubu Tree"');
    expect(defaultLegalContent('bao-mat', FILLED, SUPPORT)).toContain('cách Công ty TNHH Tubu ("Tubu Tree"');
  });

  it('điền từng phần: phần thiếu vẫn giữ chỗ [ ]', () => {
    const text = defaultLegalContent('dieu-khoan', { ...VARS, taxCode: '0312345678' }, SUPPORT);
    expect(text).toContain('- Mã số thuế: 0312345678');
    expect(text).toContain('- Đơn vị vận hành: [Tên công ty]');
    expect(text).toContain('- Địa chỉ: [Địa chỉ trụ sở]');
  });
});

describe('legal — phí vận chuyển đúng luật tính phí thật', () => {
  const vc = (v: object) => defaultLegalContent('van-chuyen', { ...VARS, ...v }, SUPPORT);

  it('miễn phí từ ngưỡng, dưới ngưỡng là phí cố định lấy từ cấu hình, không nói theo địa chỉ hay khối lượng đơn', () => {
    const text = vc({ freeshipThreshold: 300000, shippingFlatFee: 25000 });
    expect(text).toContain('Đơn từ 300.000đ được miễn phí vận chuyển');
    expect(text).toContain('phí vận chuyển cố định 25.000đ');
    expect(text).not.toContain('được tính theo địa chỉ nhận hàng và khối lượng');
  });

  it('thiếu biến phí thì dùng 19.000đ; phí 0 thì nói không mất phí; freeship mọi đơn thì không nói phí cố định', () => {
    expect(vc({})).toContain('phí vận chuyển cố định 19.000đ');
    expect(vc({ shippingFlatFee: 0 })).toContain('cũng không mất phí vận chuyển');
    expect(vc({ freeshipThreshold: 0 })).not.toContain('phí vận chuyển cố định');
  });
});

describe('legal — chính sách đổi trả: tiền hoàn đi đâu', () => {
  const text = defaultLegalContent('doi-tra', VARS, SUPPORT);
  it('nói đúng như Mini App và luồng hoàn tiền của API: Ví Tubu hoặc tài khoản ngân hàng khách chọn sau khi duyệt', () => {
    expect(text).toContain('hoàn tiền vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn sau khi duyệt');
    expect(text).not.toContain('theo cách bạn đã thanh toán');
  });
});
