import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// D5-10: số tiền trong chữ (voucher, ngưỡng freeship, giá trị điểm...) do admin đổi được trong SystemConfig. Viết cứng trong
// vi.ts thì admin đổi cấu hình là app nói sai mà không ai hay. Chữ nào cần số phải nhận số làm tham số từ config công khai.
// Ngoại lệ thật sự (số không do admin chỉnh, vd. giá niêm yết cố định của một dịch vụ) ghi chú ngay trên dòng:
//   // hardcoded-amount-ok: <lý do>
const AMOUNT = /\d{1,3}(\.\d{3})+đ/;
const MARKER = /\/\/ hardcoded-amount-ok: (.+)$/;

const lines = readFileSync(resolve(__dirname, './vi.ts'), 'utf8').split('\n');
const isCommentOnly = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);
const hits = lines
  .map((text, i) => ({ text, no: i + 1 }))
  .filter(({ text }) => !isCommentOnly(text) && AMOUNT.test(text));

describe('vi.ts không viết cứng số tiền', () => {
  it('bộ lọc nhận ra số tiền kiểu Việt ("199.000đ", "1.250.000đ") và bỏ qua số không phải tiền', () => {
    expect(AMOUNT.test('Đơn từ 199.000đ')).toBe(true);
    expect(AMOUNT.test('tối đa 1.250.000đ')).toBe(true);
    expect(AMOUNT.test('Cho đơn từ ${min}')).toBe(false);
    expect(AMOUNT.test('Giảm 30%')).toBe(false);
    expect(AMOUNT.test('199000đ')).toBe(false);
  });

  it('mọi dòng có số tiền cứng đều ghi lý do ngoại lệ ngay trên dòng', () => {
    const bare = hits.filter(({ text }) => !MARKER.test(text)).map(({ no, text }) => `vi.ts:${no}: ${text.trim()}`);
    expect(bare).toEqual([]);
  });

  it('lý do ngoại lệ đủ rõ (≥ 15 ký tự), không ghi cho có', () => {
    for (const { text, no } of hits) {
      const reason = MARKER.exec(text)?.[1] ?? '';
      expect(reason.trim().length, `vi.ts:${no}`).toBeGreaterThanOrEqual(15);
    }
  });
});
