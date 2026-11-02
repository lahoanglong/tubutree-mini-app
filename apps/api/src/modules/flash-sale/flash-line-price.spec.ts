import { FLASH_OWN_SALE_NOTICE, flashLimitMessage } from './flash-line-price';
import type { EffectivePrice } from './flash-sale.service';

const offer = (over: Partial<EffectivePrice> = {}): EffectivePrice => ({
  flashPrice: 26_000, itemId: 'fi1', endAt: new Date('2026-11-02T12:00:00Z'), soldCount: 0, quota: 10, ...over,
});

// Chữ khách đọc: "Giờ vàng" hoa chữ G, "Còn n suất" thay "Chỉ còn n suất" (thiết kế §4 Q5, review/extra-critique-2 P1 #7).
describe('flashLimitMessage: chữ khách đọc', () => {
  it('người mua là người tạo đợt', () => {
    expect(flashLimitMessage(offer({ ownSale: true, allowance: 0 }), 1)).toBe(FLASH_OWN_SALE_NOTICE);
    expect(FLASH_OWN_SALE_NOTICE).toBe('Bạn tạo đợt Giờ vàng này nên không mua được giá Giờ vàng.');
  });

  it('hết suất của khách', () => {
    expect(flashLimitMessage(offer({ allowance: 0 }), 2)).toBe('Bạn đã dùng hết suất Giờ vàng của sản phẩm này, sản phẩm đang tính giá thường.');
  });

  it('suất còn lại của cả đợt thấp hơn suất của khách: "Còn n suất Giờ vàng"', () => {
    expect(flashLimitMessage(offer({ allowance: 1, quotaLeft: 1, perUserLeft: 3 }), 3)).toBe(
      'Còn 1 suất Giờ vàng. Giảm số lượng còn 1 để được giá Giờ vàng, hoặc mua 3 sản phẩm với giá thường.',
    );
  });

  it('giới hạn mỗi khách thấp hơn suất còn lại của đợt', () => {
    expect(flashLimitMessage(offer({ allowance: 1, quotaLeft: 5, perUserLeft: 1 }), 2)).toBe(
      'Giá Giờ vàng chỉ áp dụng tối đa 1 sản phẩm cho bạn. Giảm số lượng còn 1 để được giá Giờ vàng, hoặc mua 2 sản phẩm với giá thường.',
    );
  });

  it.each([
    ['ownSale', offer({ ownSale: true, allowance: 0 })],
    ['hết suất', offer({ allowance: 0 })],
    ['quota thấp', offer({ allowance: 1, quotaLeft: 1, perUserLeft: 3 })],
    ['mỗi khách', offer({ allowance: 1, quotaLeft: 5, perUserLeft: 1 })],
  ])('nhánh %s: không có "giờ vàng" viết thường, "Chỉ còn" hay "flash"', (_name, o) => {
    const text = flashLimitMessage(o, 3);
    expect(text).not.toMatch(/giờ vàng|Chỉ còn|flash/);
  });
});
