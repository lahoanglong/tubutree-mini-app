import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import { vi } from './vi';

/**
 * Thuật ngữ đã chốt (Q-26): "Mã giảm giá", "Điểm Xanh", "Ví Tubu", "giọt nước". Quét mã nguồn để một
 * chữ cũ không quay lại ở màn nào khác (kho mã, thanh toán, giỏ, cửa hàng thương hiệu...).
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
const sources = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.spec\./.test(f))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

const offenders = (re: RegExp) => sources.filter((s) => re.test(s.text)).map((s) => s.file);

// "TubuXu" mọi dạng viết (dính liền, cách bằng khoảng trắng thường/không-ngắt, gạch nối).
const TUBU_XU = /Tubu[\s\u00A0-]?Xu(?![\p{L}_])/iu;
// "xu" đứng riêng làm đơn vị tiền ("50 xu"). Cụm "xu cũ" (giải thích lô điểm quy đổi từ xu cũ) và "xu hướng" là chữ hợp lệ;
// "XU_CONVERTED", "xuống", "xuất" không phải chữ "xu" đứng riêng.
const STANDALONE_XU = /(?<![\p{L}\p{N}_])[Xx]u(?![\p{L}\p{N}_])(?!\s(?:cũ|hướng))/u;

describe('thuật ngữ Q-26 — một chữ cho một khái niệm', () => {
  it('không còn "Mã ưu đãi" (dùng "Mã giảm giá")', () => {
    expect(offenders(/mã ưu đãi/i)).toEqual([]);
  });

  it('TubuXu đã gộp vào Điểm Xanh: không còn "TubuXu"/"Tubu Xu" ở bất kỳ dạng viết nào (T19, PD-3)', () => {
    expect(offenders(TUBU_XU)).toEqual([]);
  });

  it('không còn "xu" đứng riêng làm đơn vị tiền ở bất kỳ câu chữ nào (chỉ còn "xu cũ" giải thích lô điểm quy đổi)', () => {
    expect(offenders(STANDALONE_XU)).toEqual([]);
  });

  it('hai mẫu quét bắt đúng cái cần bắt và bỏ qua chữ hợp lệ (đối chứng, để mẫu không âm thầm hỏng)', () => {
    for (const bad of ['Mua bằng TubuXu', 'Tubu Xu', 'Tubu\u00A0Xu', 'Tubu-Xu', 'TUBU XU']) expect(TUBU_XU.test(bad), bad).toBe(true);
    for (const ok of ['Tubu Xuân', 'Tubu', 'XU_CONVERTED']) expect(TUBU_XU.test(ok), ok).toBe(false);
    for (const bad of ['Còn 50 xu', 'Xu của bạn', 'đổi xu.', '(xu)']) expect(STANDALONE_XU.test(bad), bad).toBe(true);
    for (const ok of ['Điểm quy đổi từ xu cũ', 'Xu hướng', 'xuống dòng', 'xuất hoá đơn', 'XU_CONVERTED', 'XU: 1']) {
      expect(STANDALONE_XU.test(ok), ok).toBe(false);
    }
  });

  it('không còn "voucher" trong câu chữ hiển thị cho khách', () => {
    expect(
      offenders(/Kho voucher|Nhận [Vv]oucher|Chưa có voucher|giá voucher|Dùng voucher|nhận 30k voucher|Voucher sau khi|lấy voucher|Voucher chào mừng/),
    ).toEqual([]);
  });

  it('"Điểm Xanh" luôn viết hoa chữ đầu, không còn "điểm Xanh" (Q-26)', () => {
    expect(offenders(/điểm Xanh/)).toEqual([]);
  });

  it('ô nhập mã ở giỏ/thanh toán nói "mã giảm giá"', () => {
    expect(vi.cart.couponPlaceholder).toBe('Nhập mã giảm giá');
  });

  it('Q14: trang chủ không ghi con số vùng đất (dữ liệu có 8 nhãn, 7 tỉnh) mà nói "từ nhiều vùng đất Việt Nam"', () => {
    expect(vi.home.brandStoryBody).not.toMatch(/\d+ vùng đất/);
    expect(vi.home.brandStoryBody).toContain('từ nhiều vùng đất Việt Nam');
    expect(offenders(/\d+ vùng đất/)).toEqual([]);
  });
});

/**
 * Q13: một kiểu đặt dấu cho cả hệ thống: "Huỷ, Xoá, Khoá, hoá đơn, tuỳ, thuỷ" (dấu trên chữ cái thứ hai của vần oa/oe/uy),
 * khớp tài liệu và admin. Địa danh giữ chính tả hành chính ("Thanh Hóa", "Khánh Hòa"). `zmp-bridge.ts` cố ý nhận cả hai
 * kiểu vì so khớp lời người dùng/Zalo gõ, không phải chữ hiển thị.
 */
const OLD_STYLE_TONE = /(?:[òóỏõọ][ae]|[ùúủũụ]y)(?![\p{L}])/u;
const PLACE_NAMES = /Thanh Hóa|Khánh Hòa/g;
const MATCHES_USER_INPUT = new Set(['services/zmp-bridge.ts']);
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('Q13 — thống nhất kiểu đặt dấu "Huỷ, Xoá, Khoá"', () => {
  it('không còn "Hủy/Xóa/Khóa/hóa/hòa/tùy/thủy" kiểu cũ trong chữ hiển thị', () => {
    const bad = sources
      .filter((s) => !MATCHES_USER_INPUT.has(s.file))
      .filter((s) => OLD_STYLE_TONE.test(stripComments(s.text).replace(PLACE_NAMES, '')))
      .map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it('mẫu quét bắt đúng kiểu cũ và bỏ qua kiểu mới, địa danh (đối chứng)', () => {
    for (const bad of ['Hủy đơn', 'Xóa ảnh', 'từ khóa', 'hóa đơn', 'ôn hòa', 'tùy chọn', 'thủy']) expect(OLD_STYLE_TONE.test(bad), bad).toBe(true);
    for (const ok of ['Huỷ đơn', 'Xoá ảnh', 'từ khoá', 'hoá đơn', 'ôn hoà', 'tuỳ chọn', 'thuỷ', 'khoản', 'loại', 'hoạt động', 'quý']) {
      expect(OLD_STYLE_TONE.test(ok), ok).toBe(false);
    }
    expect(OLD_STYLE_TONE.test('Thanh Hóa'.replace(PLACE_NAMES, ''))).toBe(false);
  });
});

/** Q16: chữ tiếng Anh/biệt ngữ ở màn trò chơi, nhân viên, CTV đã Việt hoá; giữ "CTV" và tên riêng. */
describe('Q16 — Việt hoá chữ tiếng Anh ở game, nhân viên, CTV', () => {
  const visible = sources.map((s) => ({ file: s.file, text: stripComments(s.text) }));
  const offendersVisible = (re: RegExp) => visible.filter((s) => re.test(s.text)).map((s) => s.file);

  it('game: không còn Season Pass, XP, Premium, Quiz, Top', () => {
    expect(offendersVisible(/Season Pass|\bXP\b|\bPremium\b|Quiz Sống Xanh|hoàn thành quiz|Top góp nước/)).toEqual([]);
    expect(vi.game.seasonPass.title).toBe('Chặng Mùa');
  });

  it('nhân viên: "Vào ca/Ra ca" thay Checkin/Checkout, "Chép" thay Copy', () => {
    expect(offendersVisible(/\bCheckin\b|\bCheckout\b|Đã checkin|Đã checkout|Đã tự checkout|Quên checkout|giờ checkin|Xác nhận checkout|Copy tuần trước|Đã copy|ca để copy/)).toEqual([]);
  });

  it('CTV: không còn Dashboard, Click, Caption, Academy', () => {
    expect(offendersVisible(/Dashboard hoa hồng|"Click"|\bclick\b ·|theo dõi click|[Cc]aption gợi ý|đã sao chép caption|Đã sao chép caption|CTV Academy|\brealtime\b/)).toEqual([]);
    expect(vi.academy.title).toBe('Học viện CTV');
  });
});
