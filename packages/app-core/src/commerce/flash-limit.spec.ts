import { describe, expect, it } from 'vitest';
import { FLASH_LIMIT_CODE, flashLimitNotice } from './flash-limit';

const SENTENCE = (n: number) => `Giá Giờ vàng chỉ áp cho ${n} sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.`;

describe('flashLimitNotice', () => {
  it('mã khớp', () => {
    expect(FLASH_LIMIT_CODE).toBe('FLASH_LIMIT');
  });

  it('Mini: limit và mã nằm trong response.data của lỗi axios', () => {
    const err = { message: 'Request failed', response: { data: { code: 'FLASH_LIMIT', limit: 3, message: 'ignored' } } };
    expect(flashLimitNotice(err)).toBe(SENTENCE(3));
  });

  it('web: ApiError có code nhưng không có limit thì dùng message của máy chủ (đã là câu hoàn chỉnh)', () => {
    expect(flashLimitNotice({ status: 400, code: 'FLASH_LIMIT', message: SENTENCE(5) })).toBe(SENTENCE(5));
  });

  it('limit nằm thẳng trên lỗi', () => {
    expect(flashLimitNotice({ code: 'FLASH_LIMIT', limit: 2, message: 'x' })).toBe(SENTENCE(2));
  });

  it('limit không phải số hữu hạn thì rơi về message', () => {
    expect(flashLimitNotice({ code: 'FLASH_LIMIT', limit: 'năm', message: 'Câu của máy chủ' })).toBe('Câu của máy chủ');
    expect(flashLimitNotice({ code: 'FLASH_LIMIT', limit: Number.NaN, message: 'Câu của máy chủ' })).toBe('Câu của máy chủ');
  });

  it('có mã mà không có limit lẫn message thì null, không bịa số', () => {
    expect(flashLimitNotice({ code: 'FLASH_LIMIT' })).toBeNull();
  });

  it('mã khác, lỗi trơn, null, chuỗi đều là null', () => {
    expect(flashLimitNotice({ code: 'PRICE_CHANGED', message: 'x' })).toBeNull();
    expect(flashLimitNotice(new Error('boom'))).toBeNull();
    expect(flashLimitNotice(null)).toBeNull();
    expect(flashLimitNotice('FLASH_LIMIT')).toBeNull();
    expect(flashLimitNotice(undefined)).toBeNull();
  });
});
