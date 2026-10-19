import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// D5-10: số tiền trong chữ (voucher, ngưỡng freeship, giá trị điểm...) do admin đổi được trong SystemConfig. Viết cứng trong
// vi.ts hay trong câu trả lời FAQ dự phòng thì admin đổi cấu hình là app nói sai mà không ai hay. Chữ nào cần số phải nhận số
// làm tham số từ config công khai. Ngoại lệ thật sự (số không do admin chỉnh, vd. giá niêm yết cố định của một dịch vụ) ghi
// chú ngay trên dòng:
//   // hardcoded-amount-ok: <lý do>
// Kiểu viết nhận ra: "199.000đ", "199,000đ", "199 000đ" (cả dấu cách không ngắt), "199.000 đ", "199.000 ₫", "199000đ", "1.250.000 VND",
// "30k", "1tr", "1,5 tr", "5 triệu", "50 nghìn". Đơn vị phải đứng một mình (sau nó không là chữ cái) để "10.000 điểm", "2 đơn",
// "2 ký tự", "2 kg", "1 trong 3", "10 trẻ" không bị tính là tiền.
const UNIT = String.raw`(?:đồng|đ|₫|vnđ|vnd)(?!\p{L})`;
const SHORT_UNIT = String.raw`(?:triệu|tr|nghìn|ngàn|k)(?!\p{L})`;
const THOUSANDS_SEP = String.raw`[.,\s\u00a0\u202f]`;
const AMOUNT = new RegExp(
  String.raw`\d{1,3}(?:${THOUSANDS_SEP}\d{3})+\s?${UNIT}|\d{4,}\s?${UNIT}|\b\d+(?:[.,]\d+)?\s?${SHORT_UNIT}`,
  'iu',
);
const MARKER = /\/\/ hardcoded-amount-ok: (.+)$/;

// Các file chứa chữ hiển thị cho khách. Thêm file mới vào đây khi có chữ có số tiền ngoài vi.ts.
const FILES = ['i18n/vi.ts', 'pages/about-data.ts'];

const isCommentOnly = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);
const hits = FILES.flatMap((file) =>
  readFileSync(resolve(__dirname, '..', file), 'utf8')
    .split('\n')
    .map((text, i) => ({ file, text, no: i + 1 }))
    .filter(({ text }) => !isCommentOnly(text) && AMOUNT.test(text)),
);

describe('chữ hiển thị không viết cứng số tiền', () => {
  it.each([
    'Đơn từ 199.000đ',
    'tối đa 1.250.000đ',
    'Đơn từ 199.000 đ',
    'Đơn từ 199.000 ₫',
    'Đơn từ 199.000 Đ',
    'chỉ 1.000đ',
    'Đơn từ 199000đ',
    'tặng 30k cho đơn đầu',
    'giảm 30 K',
    'từ 5 triệu',
    'còn 50 nghìn',
    'tối đa 1.250.000 VND',
    'phí 1.000 đồng',
    'Đơn từ 199,000đ',
    'Đơn từ 199,000 đ',
    'Đơn từ 199 000đ',
    'Đơn từ 199 000 ₫',
    'Đơn từ 199\u00a0000đ',
    'Đơn từ 1 250 000đ',
    'Đơn từ 1tr',
    'Đơn từ 1 tr',
    'Đơn từ 1,5tr',
    'Đơn từ 1.5tr',
  ])('bộ lọc nhận ra số tiền: %s', (text) => {
    expect(AMOUNT.test(text)).toBe(true);
  });

  it.each([
    'Cho đơn từ ${min}',
    'Giảm 30%',
    'Tối đa 20% giá trị đơn',
    'Điểm có hạn 12 tháng',
    'cần 1.000 điểm để lên hạng',
    'đã dùng 10.000 điểm',
    'mua 2 đơn',
    'còn 3 ngày',
    'năm 2026',
    'Mã BLACK30K',
    'Nhập ít nhất 2 ký tự',
    'nặng 2 kg',
    'cần 1 000 điểm để lên hạng',
    'cần 1,000 điểm để lên hạng',
    'đã dùng 10 000 điểm',
    'Mua 1 trong 3 đơn',
    'Có 10 trẻ em',
    'Mã SALE1TR',
    'Gọi 0984 606 774',
    'Số 12 345 đường Lê Lợi',
    'Điểm danh 7 ngày liên tiếp',
  ])('bộ lọc bỏ qua chữ không phải tiền: %s', (text) => {
    expect(AMOUNT.test(text)).toBe(false);
  });

  it('quét cả vi.ts lẫn câu hỏi thường gặp dự phòng của trang Về Tubu Tree', () => {
    expect(FILES).toEqual(expect.arrayContaining(['i18n/vi.ts', 'pages/about-data.ts']));
  });

  it('mọi dòng có số tiền cứng đều ghi lý do ngoại lệ ngay trên dòng', () => {
    const bare = hits.filter(({ text }) => !MARKER.test(text)).map(({ file, no, text }) => `${file}:${no}: ${text.trim()}`);
    expect(bare).toEqual([]);
  });

  it('lý do ngoại lệ đủ rõ (≥ 15 ký tự), không ghi cho có', () => {
    for (const { file, text, no } of hits) {
      const reason = MARKER.exec(text)?.[1] ?? '';
      expect(reason.trim().length, `${file}:${no}`).toBeGreaterThanOrEqual(15);
    }
  });
});
