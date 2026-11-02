import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as notice from './flash-sale-notice';
import * as service from './flash-sale.service';

describe('flash-sale-notice: câu khách đọc của Giờ vàng', () => {
  // Mini App bản cũ so khớp đúng hai câu này (checkout.tsx, checkout-rules.ts): đổi chữ là gãy nhánh "sửa được ở giỏ".
  it('giữ nguyên chữ client cũ so khớp', () => {
    expect(notice.FLASH_SOLD_OUT_MSG).toBe('Hết suất ưu đãi.');
    expect(notice.FLASH_OVER_LIMIT_MSG).toBe('Vượt giới hạn mua ưu đãi.');
    expect(notice.FLASH_LIMIT).toBe('FLASH_LIMIT');
  });

  it('flashOverLimitMessage điền số vào câu', () => {
    expect(notice.flashOverLimitMessage(2)).toBe('Giá Giờ vàng chỉ áp cho 2 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.');
  });

  it('câu nhắc nhở và 404 của khách', () => {
    expect(notice.FLASH_ALREADY_STARTED_MSG).toBe('Ưu đãi đã bắt đầu.');
    expect(notice.FLASH_SLOT_NOT_FOUND_MSG).toBe('Không tìm thấy khung Giờ vàng.');
    expect(notice.FLASH_ITEM_NOT_FOUND_MSG).toBe('Không tìm thấy sản phẩm Giờ vàng.');
  });

  it('flash-sale.service vẫn xuất lại các tên cũ, cùng giá trị', () => {
    expect(service.FLASH_SOLD_OUT_MSG).toBe(notice.FLASH_SOLD_OUT_MSG);
    expect(service.FLASH_OVER_LIMIT_MSG).toBe(notice.FLASH_OVER_LIMIT_MSG);
    expect(service.FLASH_LIMIT).toBe(notice.FLASH_LIMIT);
    expect(service.FLASH_ALREADY_STARTED_MSG).toBe(notice.FLASH_ALREADY_STARTED_MSG);
    expect(service.flashOverLimitMessage(3)).toBe(notice.flashOverLimitMessage(3));
  });

  it('file chữ khách đọc không dùng thuật ngữ cấm (flash sale, Freeship, voucher)', () => {
    const src = readFileSync(join(__dirname, 'flash-sale-notice.ts'), 'utf8');
    expect(src).not.toMatch(/flash sale|freeship|voucher/i);
  });
});
