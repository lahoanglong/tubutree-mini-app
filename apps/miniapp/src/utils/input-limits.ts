/**
 * Trần độ dài của ô nhập, bằng đúng trần `@MaxLength` (hoặc độ dài lớn nhất mà regex) của DTO nhận giá trị đó.
 * Khách gõ quá trần thì API trả 400; chặn ngay ở ô nhập thì khỏi mất công điền lại.
 * `input-limits.spec.ts` đối chiếu từng giá trị với DTO.
 */
export const INPUT_LIMITS = {
  reviewComment: 2000,
  addressRecipient: 120,
  addressPhone: 20,
  addressStreet: 255,
  // Ô MST hoá đơn: khách dán cả dấu chấm/khoảng trắng, client bỏ chúng rồi mới kiểm (DTO nhận tối đa 14 sau chuẩn hoá).
  invoiceTaxCode: 28,
  invoiceCompanyName: 255,
  invoiceAddress: 500,
  invoiceEmail: 254,
  recycleCarrier: 60,
  recycleTrackingCode: 64,
  externalPointsCode: 100,
  voucherCode: 64,
  affiliateTaxId: 14,
} as const;

/** Ô của form địa chỉ giao hàng theo tên trường. */
export const ADDRESS_INPUT_LIMIT = {
  recipient: INPUT_LIMITS.addressRecipient,
  phone: INPUT_LIMITS.addressPhone,
  street: INPUT_LIMITS.addressStreet,
} as const;
