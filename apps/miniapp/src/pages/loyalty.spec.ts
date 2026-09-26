import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Quét mã nguồn trang Hạng thành viên (rẻ, không cần dựng zmp-ui) — chặn tái diễn các lỗi bản WIP:
 *  - thẻ thành viên vẽ dãy vạch GIẢ giống hệt nhau cho mọi khách, máy quét không đọc được gì;
 *  - mã quét phải là đúng chuỗi memberCode mà endpoint /loyalty/staff/scan-member nhận;
 *  - danh mục đổi quà / điểm danh kẹt "Đang tải…" mãi khi API lỗi;
 *  - báo "Đã sao chép" kể cả khi copyText trả false.
 */
const src = readFileSync(join(process.cwd(), 'src', 'pages', 'loyalty.tsx'), 'utf8');

describe('loyalty.tsx — thẻ thành viên', () => {
  it('không còn mã vạch giả (mảng độ rộng vạch cố định)', () => {
    expect(src).not.toMatch(/\[3, 1, 2, 4, 1, 3/);
    expect(src).not.toMatch(/Mô phỏng vạch/);
  });

  it('vẽ QR thật bằng component QrCode có sẵn, mã hoá CHÍNH chuỗi memberCode', () => {
    expect(src).toMatch(/import \{ QrCode(?: as [A-Za-z]+)? \} from '\.\.\/components\/qr-code'/);
    expect(src).toMatch(/value=\{memberCardQ\.data\.memberCode\}/);
  });

  it('không hứa "quét mã vạch tại quầy POS" cứng — lời nhắc lấy từ memberCardHint (theo cờ backend)', () => {
    expect(src).not.toMatch(/Quét mã vạch tại quầy/);
    expect(src).toMatch(/memberCardHint\(/);
  });

  it('chỉ báo "Đã sao chép" khi copyText trả true', () => {
    expect(src).toMatch(/const ok = await copyText\(/);
  });
});

describe('loyalty.tsx — trạng thái tải/lỗi', () => {
  it('danh mục đổi quà và điểm danh có nhánh isError + nút thử lại', () => {
    expect(src).toMatch(/rewardsQ\.isError/);
    expect(src).toMatch(/checkInQ\.isError/);
    expect(src).toMatch(/rewardsQ\.refetch\(\)/);
    expect(src).toMatch(/checkInQ\.refetch\(\)/);
  });

  it('lịch sử điểm dùng pointsReasonLabel (không hiện mã thô DAILY_CHECKIN:DAY_n)', () => {
    expect(src).toMatch(/pointsReasonLabel\(t\.reason\)/);
  });

  it('thanh tiến độ lên hạng dùng tierProgressPercent (điểm xét hạng, không phải số dư)', () => {
    expect(src).toMatch(/tierProgressPercent\(/);
  });
});
