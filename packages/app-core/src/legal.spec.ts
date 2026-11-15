import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_LEGAL_SUPPORT,
  DEFAULT_LEGAL_VARS,
  LEGAL_DRAFT_NOTICE,
  LEGAL_PAGES,
  LEGAL_SLUGS,
  TUBU_TREE_MERCHANT,
  defaultLegalContent,
  isBctNoticeUrl,
  isLegalSlug,
  merchantIdentityOrDefault,
} from './legal';

const VARS = { returnWindowDays: 7, freeshipThreshold: 199000 };
const SUPPORT = { hotline: '0984 606 774', email: 'tubutree@gmail.com' };

describe('DEFAULT_LEGAL_VARS (Q12)', () => {
  it('ngưỡng freeship dự phòng 199.000đ', () => {
    expect(DEFAULT_LEGAL_VARS.freeshipThreshold).toBe(199000);
  });
});

describe('legal — khung trang điều khoản/chính sách (D5-01)', () => {
  it('đúng năm trang, theo thứ tự hiển thị ở chân trang', () => {
    expect([...LEGAL_SLUGS]).toEqual(['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen', 'thanh-toan']);
    for (const slug of LEGAL_SLUGS) expect(LEGAL_PAGES[slug].title.length).toBeGreaterThan(5);
    expect(LEGAL_PAGES['thanh-toan'].title).toBe('Chính sách và hình thức thanh toán');
    expect(LEGAL_PAGES['thanh-toan'].footerLabel).toBe('Thanh toán');
  });

  it('isLegalSlug chỉ nhận năm mã, kể cả khi đường dẫn là tên thuộc tính của Object', () => {
    for (const ok of LEGAL_SLUGS) expect(isLegalSlug(ok)).toBe(true);
    for (const bad of ['', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'Dieu-Khoan', 'dieu-khoan/', 'thanh-toan/', 'admin']) {
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
    expect(text).toContain('Mọi phần hàng do Tubu Tree giao đều được miễn phí vận chuyển');
    expect(text).not.toContain('Đơn từ');
    expect(text).not.toContain('từ 0đ');
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
    for (const other of ['bao-mat', 'doi-tra', 'van-chuyen', 'thanh-toan']) expect(dk).toContain(`](/chinh-sach/${other})`);
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
    expect(text).toContain('Phần hàng do Tubu Tree giao từ 300.000đ được miễn phí vận chuyển');
    expect(text).toContain('của riêng phần đó');
    expect(text).toContain('gian hàng đối tác được giao riêng, theo phí và mức miễn phí vận chuyển của chính gian hàng đó');
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

describe('legal — Chính sách và hình thức thanh toán (thanh-toan)', () => {
  const text = defaultLegalContent('thanh-toan', VARS, SUPPORT);

  it('nêu đủ các hình thức: COD, chuyển khoản VietQR, Ví Tubu, ZaloPay, Điểm Xanh', () => {
    for (const phrase of ['Thanh toán khi nhận hàng (COD)', 'Chuyển khoản ngân hàng (quét mã VietQR)', 'Ví Tubu', 'ZaloPay', 'Điểm Xanh']) {
      expect(text).toContain(phrase);
    }
  });

  it('ZaloPay chỉ được hứa khi bước thanh toán đang hiển thị nó (hiện cả hai app đang ẩn ZaloPay)', () => {
    expect(text).toMatch(/ZaloPay: áp dụng khi hình thức này được hiển thị ở bước thanh toán/);
  });

  it('không thu tiền trước khi giao, trừ khi khách chủ động chọn trả trước và có đối soát minh bạch', () => {
    expect(text).toContain('Với đơn COD, Tubu Tree không thu tiền trước khi giao hàng');
    expect(text).toContain('Chỉ khi bạn chủ động chọn chuyển khoản');
    expect(text).toContain('đối soát và ghi nhận minh bạch');
  });

  it('hoàn tiền: trường hợp, về Ví Tubu hoặc tài khoản ngân hàng khách chọn, thời hạn khớp với chính sách đổi trả', () => {
    expect(text).toContain('Ví Tubu hoặc tài khoản ngân hàng bạn chọn');
    expect(text).toContain('7 ngày làm việc');
    expect(text).toContain('](/chinh-sach/doi-tra)');
    expect(defaultLegalContent('doi-tra', VARS, SUPPORT)).toContain('Thời gian hoàn tiền: 7 ngày làm việc');
  });

  it('bảo mật giao dịch: không lưu số thẻ, xác thực tại cổng, không nhận OTP', () => {
    expect(text).toContain('không lưu số thẻ ngân hàng');
    expect(text).toContain('xác thực tại chính cổng thanh toán');
    expect(text).toContain('không nhận mật khẩu hay mã OTP');
  });

  it('đầu mối khiếu nại lấy từ cấu hình hỗ trợ, không bịa số điện thoại hay email mới', () => {
    const custom = defaultLegalContent('thanh-toan', VARS, { hotline: '0900 111 222', email: 'ho-tro@example.vn' });
    expect(custom).toContain('hotline 0900 111 222 hoặc email ho-tro@example.vn');
    expect(custom).not.toContain('0984 606 774');
    expect(text).toContain(`hotline ${DEFAULT_LEGAL_SUPPORT.hotline} hoặc email ${DEFAULT_LEGAL_SUPPORT.email}`);
  });

  it('không nhắc cổng thanh toán ngoài danh sách (Visa, MasterCard, MoMo, VNPay)', () => {
    expect(text).not.toMatch(/Visa|MasterCard|MoMo|VNPay/i);
  });
});

describe('legal — tiểu mục "Chính sách kiểm hàng khi nhận hàng"', () => {
  const HEADING = 'Chính sách kiểm hàng khi nhận hàng';

  it.each(['doi-tra', 'van-chuyen'] as const)('%s: có tiểu mục riêng, nêu đồng kiểm, quay video, thời hạn báo và hoàn tiền', (slug) => {
    const text = defaultLegalContent(slug, VARS, SUPPORT);
    expect(text).toMatch(new RegExp(`^#{2,3} (\\d+\\. )?${HEADING}$`, 'm'));
    const section = text.slice(text.indexOf(HEADING));
    expect(section).toContain('Đồng kiểm');
    expect(section).toContain('cùng nhân viên giao hàng (bưu tá) kiểm tra ngoại quan kiện hàng và số lượng');
    expect(section).toContain('quay video');
    expect(section).toContain('Thời hạn báo');
    expect(section).toContain('Hoàn tiền');
  });

  it('thời hạn báo lấy từ số ngày đổi trả đang chạy, ở cả hai trang', () => {
    for (const slug of ['doi-tra', 'van-chuyen'] as const) {
      expect(defaultLegalContent(slug, { ...VARS, returnWindowDays: 10 }, SUPPORT)).toContain('trong vòng 10 ngày kể từ khi đơn được giao thành công, kèm ảnh hoặc video');
    }
  });

  it('hạn đổi trả 0 ngày: bảo khách báo ngay lúc nhận, không in "0 ngày"', () => {
    for (const slug of ['doi-tra', 'van-chuyen'] as const) {
      const text = defaultLegalContent(slug, { ...VARS, returnWindowDays: 0 }, SUPPORT);
      expect(text).toContain('báo ngay tại thời điểm nhận hàng');
      expect(text).not.toContain('0 ngày');
    }
  });
});

describe('legal — bản cập nhật PROD trong migration W168', () => {
  const sql = readFileSync(resolve(__dirname, '../../../apps/api/prisma/migrations/20261115172000_w168_legal_thanh_toan/migration.sql'), 'utf8');

  it('thêm khoá legal.thanh-toan bằng INSERT ... ON CONFLICT DO NOTHING (không đè bản admin đã sửa)', () => {
    expect(sql).toMatch(/INSERT INTO "system_configs"[\s\S]*'legal\.thanh-toan'[\s\S]*ON CONFLICT \("key"\) DO NOTHING/);
  });

  it('nội dung thanh-toan trong migration đủ các ý bắt buộc và đúng thông tin thương nhân', () => {
    for (const phrase of [
      'Thanh toán khi nhận hàng (COD)',
      'VietQR',
      'Ví Tubu',
      'ZaloPay',
      'Điểm Xanh',
      'không thu tiền trước khi giao hàng',
      'Hoàn tiền',
      'không lưu số thẻ ngân hàng',
      TUBU_TREE_MERCHANT.legalName,
      TUBU_TREE_MERCHANT.taxCode,
      TUBU_TREE_MERCHANT.address,
      DEFAULT_LEGAL_SUPPORT.hotline,
      DEFAULT_LEGAL_SUPPORT.email,
    ]) {
      expect(sql).toContain(phrase);
    }
  });

  it('chỉ nối tiểu mục kiểm hàng vào bản PROD đang có nội dung mà CHƯA có chữ "kiểm hàng"', () => {
    for (const key of ['legal.van-chuyen', 'legal.doi-tra']) expect(sql).toContain(`'${key}'`);
    expect(sql).toContain(`jsonb_typeof(c."value") = 'string'`);
    expect(sql).toContain(`btrim(c."value" #>> '{}') <> ''`);
    expect(sql).toMatch(/NOT ILIKE '%kiểm hàng%'/);
    expect(sql).toContain('## Chính sách kiểm hàng khi nhận hàng');
    for (const phrase of ['Đồng kiểm', 'quay video', 'Thời hạn báo', 'Hoàn tiền']) expect(sql).toContain(phrase);
  });
});

describe('merchantIdentityOrDefault — thông tin thương nhân ở chân trang', () => {
  it('chưa nhập gì (rỗng, khoảng trắng, null, undefined) thì dùng thông tin đã đăng ký của Tubu Tree', () => {
    const expected = { legalName: 'CÔNG TY TNHH TUBU TREE', taxCode: '0319585995', address: 'Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh' };
    expect(merchantIdentityOrDefault(undefined)).toEqual(expected);
    expect(merchantIdentityOrDefault(null)).toEqual(expected);
    expect(merchantIdentityOrDefault({ legalName: null, taxCode: '  ', address: '' })).toEqual(expected);
  });

  it('admin đã nhập bất kỳ trường nào thì giữ đúng những gì họ nhập, không trộn với mặc định', () => {
    expect(merchantIdentityOrDefault({ legalName: 'Công ty X', taxCode: null, address: null })).toEqual({ legalName: 'Công ty X', taxCode: undefined, address: undefined });
    expect(merchantIdentityOrDefault({ taxCode: '0312345678' }).legalName).toBeUndefined();
  });
});

describe('isBctNoticeUrl — chỉ link thật của Bộ Công Thương mới được hiện huy hiệu', () => {
  it.each([
    'https://online.gov.vn/Home/WebDetails/12345',
    'https://online.gov.vn',
    'https://ONLINE.gov.vn/x',
    'https://www.online.gov.vn/Home/WebDetails/1',
    'https://tmdt.gov.vn/xac-nhan',
  ])('nhận %s', (url) => {
    expect(isBctNoticeUrl(url)).toBe(true);
  });

  it.each([
    ['rỗng', ''],
    ['chỉ khoảng trắng', '   '],
    ['http không mã hoá', 'http://online.gov.vn/x'],
    ['tên miền lạ', 'https://example.com/online.gov.vn'],
    ['giả tên miền bằng hậu tố', 'https://online.gov.vn.evil.com/x'],
    ['giả tên miền bằng gạch nối', 'https://evilgov.vn/x'],
    ['có tên đăng nhập (@ lừa host)', 'https://online.gov.vn@evil.com/x'],
    ['có mật khẩu', 'https://u:p@online.gov.vn/x'],
    ['cổng lạ', 'https://online.gov.vn:8443/x'],
    ['javascript', 'javascript:alert(1)'],
    ['không phải URL', 'online.gov.vn'],
    ['dài quá 500 ký tự', `https://online.gov.vn/${'a'.repeat(500)}`],
    ['thừa khoảng trắng', ' https://online.gov.vn/x'],
  ])('từ chối: %s', (_name, url) => {
    expect(isBctNoticeUrl(url)).toBe(false);
  });

  it.each([null, undefined, 5, {}, ['https://online.gov.vn']])('từ chối giá trị không phải chuỗi: %j', (v) => {
    expect(isBctNoticeUrl(v)).toBe(false);
  });
});
