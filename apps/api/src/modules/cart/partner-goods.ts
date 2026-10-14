import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Hàng của gian hàng đối tác: sản phẩm thuộc một gian hàng (`Product.storefrontId`), dù đối tác tự giao hay Tubu giao hộ.
 * Hàng này chỉ bán theo giá lẻ niêm yết cộng mã giảm giá của khách: không giá đại lý, không giảm giá định kỳ, không combo CTV,
 * không mua chung, không trả bằng Điểm Xanh (docs/2026-10-14-merchant-fulfilment-design.md mục 7). Giá giờ vàng do admin đặt
 * thì giữ. Mọi nơi xét các chương trình đó dùng chung luật này.
 */
export function isPartnerOwnedProduct(product: { storefrontId?: string | null } | null | undefined): boolean {
  return product?.storefrontId != null;
}

export function isPartnerOwnedVariation(variation: { product: { storefrontId?: string | null } | null } | null | undefined): boolean {
  return isPartnerOwnedProduct(variation?.product);
}

/** Điều kiện Prisma của biến thể hàng Tubu, cùng luật isPartnerOwnedProduct. */
export const TUBU_OWNED_VARIATION_WHERE = { product: { storefrontId: null } } as const satisfies Prisma.VariationWhereInput;

/** Mã lỗi ổn định để FE nhận diện. */
export const PARTNER_GOODS_NOT_ELIGIBLE = 'PARTNER_GOODS_NOT_ELIGIBLE';

export type PartnerGoodsProgram = 'DEALER' | 'SUBSCRIPTION' | 'COMBO' | 'GROUP_BUY';

const PROGRAM_TEXT: Record<PartnerGoodsProgram, string> = {
  DEALER: 'không bán theo giá đại lý',
  SUBSCRIPTION: 'không đặt định kỳ được',
  COMBO: 'không thêm vào combo được',
  GROUP_BUY: 'không mở mua chung được',
};

export function partnerGoodsMessage(program: PartnerGoodsProgram, productName?: string | null): string {
  const subject = productName ? `Sản phẩm "${productName}"` : 'Sản phẩm này';
  return `${subject} là hàng của gian hàng đối tác, ${PROGRAM_TEXT[program]}. Hàng của gian hàng đối tác chỉ bán theo giá lẻ niêm yết.`;
}

export function partnerGoodsError(program: PartnerGoodsProgram, productName?: string | null): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: PARTNER_GOODS_NOT_ELIGIBLE,
    message: partnerGoodsMessage(program, productName),
  });
}

/** Câu giải thích cạnh ô Điểm Xanh khi lần đặt có hàng của gian hàng đối tác (báo giá trả về, màn thanh toán hiện). */
export const PARTNER_POINTS_NOTE = 'Điểm Xanh chỉ dùng cho hàng của Tubu, không dùng cho hàng của gian hàng đối tác';
