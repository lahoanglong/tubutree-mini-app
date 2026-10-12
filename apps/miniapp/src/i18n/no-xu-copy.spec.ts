import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import { vi } from './vi';

/**
 * T19 (PD-3, Q-26): TubuXu đã gộp vào Điểm Xanh. Khách không còn thấy chữ "xu"/"TubuXu" ở màn nào;
 * chỉ còn nhãn dòng sổ/đơn cũ nói "xu cũ" để đọc được lịch sử. Quét mã nguồn (kể cả chú thích) để một
 * chữ cũ không quay lại.
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

// "XU" viết hoa là tên giá trị enum PaymentMethod/PointsLot của API (đơn cũ), không phải chữ hiển thị.
const XU_WORD = /(?<![\p{L}_])[Xx]u(?![\p{L}_])/u;
const TUBU_XU = /tubu ?xu/iu;
const ALLOWED = /xu cũ/giu;

describe('không còn chữ xu / TubuXu trong mã nguồn miniapp (T19, PD-3)', () => {
  it('chỉ còn cụm "xu cũ" (nhãn dòng sổ/đơn cũ), mọi chữ xu khác đã biến mất', () => {
    const offenders = sources
      .filter((s) => {
        const text = s.text.replace(ALLOWED, '');
        return XU_WORD.test(text) || TUBU_XU.test(text);
      })
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('không còn tên hàm/field của xu: formatXu, coinsBalance, getCoins, convertToXu', () => {
    const offenders = sources.filter((s) => /formatXu|coinsBalance|getCoins|convertToXu|rewardXu/.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('nhãn cho khách: thưởng Season Pass dạng điểm hiện "điểm", đơn cũ trả bằng xu hiện "xu cũ"', () => {
    expect(vi.game.seasonPass.reward({ type: 'POINTS', amount: 5 })).toBe('5 điểm');
    expect(vi.paymentMethod.XU).toBe('Điểm Xanh (xu cũ)');
  });

  it('i18n không còn nhãn chọn phương thức thanh toán TubuXu', () => {
    expect('paymentXu' in (vi.checkout as Record<string, unknown>)).toBe(false);
  });
});
