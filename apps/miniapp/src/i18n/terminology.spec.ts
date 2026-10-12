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
      offenders(/Kho voucher|Nhận [Vv]oucher|Chưa có voucher|giá voucher|Dùng voucher|nhận 30k voucher|Voucher sau khi|lấy voucher/),
    ).toEqual([]);
  });

  it('"Điểm Xanh" luôn viết hoa chữ đầu, không còn "điểm Xanh" (Q-26)', () => {
    expect(offenders(/điểm Xanh/)).toEqual([]);
  });

  it('ô nhập mã ở giỏ/thanh toán nói "mã giảm giá"', () => {
    expect(vi.cart.couponPlaceholder).toBe('Nhập mã giảm giá');
  });
});
