/**
 * Trần độ dài của ô nhập, bằng đúng trần `@MaxLength` (hoặc độ dài lớn nhất mà regex) của DTO nhận giá trị đó.
 * Khách gõ quá trần thì API trả 400; chặn ngay ở ô nhập thì khỏi mất công điền lại.
 * `input-limits.spec.ts` đối chiếu từng giá trị với DTO.
 */
export const INPUT_LIMITS = {
  reviewComment: 2000,
  dealerBusinessName: 120,
  dealerOwnerName: 120,
  dealerPhone: 30,
  dealerAddress: 500,
  dealerTaxCode: 14,
  dealerTemplateName: 120,
  addressRecipient: 120,
  addressPhone: 20,
  addressStreet: 255,
  invoiceTaxCode: 14,
  invoiceCompanyName: 255,
  invoiceAddress: 500,
  invoiceEmail: 254,
  storefrontTitle: 120,
  storefrontSubdomain: 30,
  storefrontWarehouseAddress: 200,
  storefrontWarehouseCity: 200,
  storefrontWarehousePhone: 200,
  collectionTitle: 80,
  brandTagline: 200,
  brandOrigin: 200,
  brandStory: 20000,
  promoTitle: 160,
  promoSubtitle: 240,
  promoCouponCode: 64,
  shiftTemplateName: 60,
  shiftRejectReason: 500,
  shiftCancelReason: 500,
  payrollNote: 500,
  bankBin: 6,
  bankAccountNo: 30,
  bankAccountName: 120,
  recycleCarrier: 60,
  recycleTrackingCode: 64,
  recycleDeskCode: 64,
  recycleRejectNote: 500,
  externalPointsCode: 100,
  voucherCode: 64,
  affiliateTaxId: 14,
  staffReason: 500,
} as const;

/** Ô của form địa chỉ giao hàng theo tên trường. */
export const ADDRESS_INPUT_LIMIT = {
  recipient: INPUT_LIMITS.addressRecipient,
  phone: INPUT_LIMITS.addressPhone,
  street: INPUT_LIMITS.addressStreet,
} as const;

/** Lý do cấp/thu hồi quyền nhân sự tối thiểu (GrantRoleDto/RevokeRoleDto `@MinLength`). */
export const STAFF_REASON_MIN = 3;
