/**
 * Enums dùng chung giữa api / miniapp / web.
 * Phải khớp 1-1 với enum trong apps/api/prisma/schema.prisma.
 */

export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  AFFILIATE: 'AFFILIATE',
  DEALER: 'DEALER',
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const OrderType = {
  RETAIL: 'RETAIL',
  DEALER: 'DEALER',
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

export const OrderStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  PACKED: 'PACKED',
  SHIPPING: 'SHIPPING',
  DELIVERED: 'DELIVERED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentMethod = {
  COD: 'COD',
  ZALOPAY: 'ZALOPAY',
  VNPAY: 'VNPAY',
  BANK_TRANSFER: 'BANK_TRANSFER',
  WALLET: 'WALLET',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  UNPAID: 'UNPAID',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const InvoiceStatus = {
  NOT_REQUESTED: 'NOT_REQUESTED',
  REQUESTED: 'REQUESTED',
  ISSUED: 'ISSUED',
  FAILED: 'FAILED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const CouponType = {
  PERCENT: 'PERCENT',
  AMOUNT: 'AMOUNT',
  FREESHIP: 'FREESHIP',
} as const;
export type CouponType = (typeof CouponType)[keyof typeof CouponType];

export const CouponScope = {
  PUBLIC: 'PUBLIC',
  TIER: 'TIER',
  USER_GROUP: 'USER_GROUP',
  BIRTHDAY: 'BIRTHDAY',
  INVITE: 'INVITE',
} as const;
export type CouponScope = (typeof CouponScope)[keyof typeof CouponScope];

export const CommissionStatus = {
  PENDING: 'PENDING',
  LOCKED: 'LOCKED',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
} as const;
export type CommissionStatus = (typeof CommissionStatus)[keyof typeof CommissionStatus];

export const PayoutStatus = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export const CashbackStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  PAID: 'PAID',
} as const;
export type CashbackStatus = (typeof CashbackStatus)[keyof typeof CashbackStatus];

export const DealerStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type DealerStatus = (typeof DealerStatus)[keyof typeof DealerStatus];
