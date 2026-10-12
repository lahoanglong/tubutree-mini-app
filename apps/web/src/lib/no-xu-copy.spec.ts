import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PAYMENT_METHOD_LABELS } from './export-csv';
import { paymentMethodLabel } from './order-view';

/**
 * T19 (PD-3, Q-26): TubuXu đã gộp vào Điểm Xanh. Web khách và admin không còn chữ "xu"/"TubuXu"; chỉ còn
 * nhãn đơn cũ nói "xu cũ" để đọc được lịch sử. Quét mã nguồn (kể cả chú thích) để chữ cũ không quay lại.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
// test-utils/fixtures chứa dòng API chụp nguyên văn (mô tả khoá cấu hình cũ còn chữ "Xu"), không phải chữ hiển thị do web viết.
const FIXTURES = join(SRC, 'test-utils', 'fixtures') + sep;
const sources = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.spec\./.test(f) && !f.startsWith(FIXTURES))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

// "XU" viết hoa là tên giá trị enum PaymentMethod của API (đơn cũ), không phải chữ hiển thị.
const XU_WORD = /(?<![\p{L}_])[Xx]u(?![\p{L}_])/u;
const TUBU_XU = /tubu ?xu/iu;
const ALLOWED = /xu cũ/giu;

describe('không còn chữ xu / TubuXu trong mã nguồn web (T19, PD-3)', () => {
  it('chỉ còn cụm "xu cũ" (nhãn đơn cũ), mọi chữ xu khác đã biến mất', () => {
    const offenders = sources
      .filter((s) => {
        const text = s.text.replace(ALLOWED, '');
        return XU_WORD.test(text) || TUBU_XU.test(text);
      })
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('không còn field coinsBalance / rewardXu trong kiểu dữ liệu web', () => {
    const offenders = sources.filter((s) => /coinsBalance|rewardXu|formatXu/.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('đơn cũ trả bằng xu: khách thấy "Điểm Xanh (xu cũ)", CSV admin thấy "Xu cũ (đã gộp Điểm Xanh)"', () => {
    expect(paymentMethodLabel('XU')).toBe('Điểm Xanh (xu cũ)');
    expect(PAYMENT_METHOD_LABELS.XU).toBe('Xu cũ (đã gộp Điểm Xanh)');
  });
});
