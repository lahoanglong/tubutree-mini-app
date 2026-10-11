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

describe('thuật ngữ Q-26 — một chữ cho một khái niệm', () => {
  it('không còn "Mã ưu đãi" (dùng "Mã giảm giá")', () => {
    expect(offenders(/mã ưu đãi/i)).toEqual([]);
  });

  it('TubuXu đã gộp vào Điểm Xanh: không còn "TubuXu"/"Tubu Xu" ở bất kỳ dạng viết nào (T19, PD-3)', () => {
    expect(offenders(/Tubu ?Xu(?![\p{L}_])/iu)).toEqual([]);
  });

  it('không còn "voucher" trong câu chữ hiển thị cho khách', () => {
    expect(
      offenders(/Kho voucher|Nhận [Vv]oucher|Chưa có voucher|giá voucher|Dùng voucher|nhận 30k voucher|Voucher sau khi|lấy voucher/),
    ).toEqual([]);
  });

  it('ô nhập mã ở giỏ/thanh toán nói "mã giảm giá"', () => {
    expect(vi.cart.couponPlaceholder).toBe('Nhập mã giảm giá');
  });
});
