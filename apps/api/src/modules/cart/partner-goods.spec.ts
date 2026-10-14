import { BadRequestException } from '@nestjs/common';
import {
  isPartnerOwnedProduct,
  isPartnerOwnedVariation,
  PARTNER_GOODS_NOT_ELIGIBLE,
  PARTNER_POINTS_NOTE,
  partnerGoodsError,
  TUBU_OWNED_VARIATION_WHERE,
} from './partner-goods';

describe('hàng của gian hàng đối tác (Q8 S2/S7)', () => {
  it('sản phẩm thuộc gian hàng (tự giao hoặc Tubu giao hộ) là hàng đối tác; sản phẩm Tubu (storefrontId null) thì không', () => {
    expect(isPartnerOwnedProduct({ storefrontId: 'sf-1' })).toBe(true);
    expect(isPartnerOwnedProduct({ storefrontId: null })).toBe(false);
    expect(isPartnerOwnedProduct(null)).toBe(false);
    expect(isPartnerOwnedVariation({ product: { storefrontId: 'sf-1' } })).toBe(true);
    expect(isPartnerOwnedVariation({ product: { storefrontId: null } })).toBe(false);
  });

  it('điều kiện Prisma cùng luật: chỉ biến thể của sản phẩm Tubu', () => {
    expect(TUBU_OWNED_VARIATION_WHERE).toEqual({ product: { storefrontId: null } });
  });

  it('lỗi có mã ổn định và câu tiếng Việt nêu rõ chương trình không áp dụng', () => {
    const cases = [
      ['DEALER', 'Sản phẩm "Mật ong" là hàng của gian hàng đối tác, không bán theo giá đại lý. Hàng của gian hàng đối tác chỉ bán theo giá lẻ niêm yết.'],
      ['SUBSCRIPTION', 'Sản phẩm "Mật ong" là hàng của gian hàng đối tác, không đặt định kỳ được. Hàng của gian hàng đối tác chỉ bán theo giá lẻ niêm yết.'],
      ['COMBO', 'Sản phẩm "Mật ong" là hàng của gian hàng đối tác, không thêm vào combo được. Hàng của gian hàng đối tác chỉ bán theo giá lẻ niêm yết.'],
      ['GROUP_BUY', 'Sản phẩm "Mật ong" là hàng của gian hàng đối tác, không mở mua chung được. Hàng của gian hàng đối tác chỉ bán theo giá lẻ niêm yết.'],
    ] as const;
    for (const [program, message] of cases) {
      const err = partnerGoodsError(program, 'Mật ong');
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: PARTNER_GOODS_NOT_ELIGIBLE, message });
    }
    expect((partnerGoodsError('DEALER').getResponse() as { message: string }).message).toMatch(/^Sản phẩm này là hàng của gian hàng đối tác/);
  });

  it('câu giải thích Điểm Xanh dùng chung cho báo giá và màn thanh toán', () => {
    expect(PARTNER_POINTS_NOTE).toBe('Điểm Xanh chỉ dùng cho hàng của Tubu, không dùng cho hàng của gian hàng đối tác');
  });
});
