/**
 * Bài mẫu và điểm bán hàng dựng sẵn khi admin chưa soạn bộ nội dung cho sản phẩm: CTV vẫn có câu chép là gửi được, kèm link giới thiệu.
 * Chỉ nói điều Tubu chắc chắn đúng (tên, thương hiệu, giá đang bán, đặt qua link, thông tin nằm trên trang sản phẩm), không nói công dụng hay
 * chất lượng: `content-kit.service.spec.ts` quét các câu này bằng `claimsIn` (bộ chặn tuyên bố dùng chung với bản nháp AI).
 * File đuôi `-notice.ts` để `terminology.spec` quét thuật ngữ cấm như mọi chữ API trả cho khách.
 */

export interface FallbackKitInput {
  productName: string;
  brandName: string | null;
  /** Giá đang bán; 0 khi không có giá hợp lệ thì câu bỏ phần giá. */
  priceVnd: number;
  /** Tên CTV; chưa đặt tên thì câu bỏ phần "Mình là …". */
  ctvName: string | null;
  link: string;
}

/** 129000 → "129.000đ", không phụ thuộc ICU của máy chủ. */
export function kitPriceText(n: number): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
}

export function fallbackKitCopy(p: FallbackKitInput): { captions: string[]; usps: string[] } {
  const name = p.productName.trim();
  const brand = p.brandName?.trim() || null;
  const price = p.priceVnd > 0 ? kitPriceText(p.priceVnd) : null;
  const ofBrand = brand ? ` của ${brand}` : '';
  return {
    captions: [
      `${name}${ofBrand} đang bán tại Tubu Tree${price ? `, giá ${price}` : ''}. Xem chi tiết và đặt hàng: ${p.link}`,
      `${p.ctvName ? `Mình là ${p.ctvName}, đang` : 'Mình đang'} giới thiệu ${name}${price ? ` (${price})` : ''}. Thông tin chi tiết và cách dùng có trên trang sản phẩm: ${p.link}`,
      `Bạn cần ${name} thì đặt qua link này để mình hỗ trợ đơn hàng nhé: ${p.link}`,
    ],
    usps: [
      ...(brand ? [`Thương hiệu ${brand}, bán trên Tubu Tree`] : []),
      ...(price ? [`Giá đang bán ${price}`] : []),
      'Đặt trực tuyến, giao tận nơi',
      'Thông tin chi tiết và cách dùng có trên trang sản phẩm',
    ],
  };
}
