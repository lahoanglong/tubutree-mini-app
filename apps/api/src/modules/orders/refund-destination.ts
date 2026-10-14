import { BadRequestException } from '@nestjs/common';
import type { PaymentMethod } from '@prisma/client';

export interface BankDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

/** Nơi khách chọn nhận tiền hoàn (D2): Ví Tubu (ngay) hoặc tài khoản ngân hàng (admin chuyển tay, miễn phí). */
export type RefundDestination = { method: 'WALLET' } | { method: 'BANK'; bank: BankDetails };

export const WALLET_DESTINATION: RefundDestination = { method: 'WALLET' };

/**
 * Kênh khách trả tiền thật ngoài Ví: chuyển khoản, ZaloPay, VNPAY, và COD đã thu (chỉ có ở trả hàng). Đơn trả bằng Ví
 * luôn hoàn về Ví; đơn XU cũ hoàn bằng Điểm Xanh.
 */
const BANK_REFUNDABLE: ReadonlySet<PaymentMethod> = new Set<PaymentMethod>(['BANK_TRANSFER', 'ZALOPAY', 'VNPAY', 'COD']);

export function canRefundToBank(method: PaymentMethod | string): boolean {
  return BANK_REFUNDABLE.has(method as PaymentMethod);
}

export interface RefundDestinationInput {
  refundMethod?: 'WALLET' | 'BANK';
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
}

/** Chuẩn hoá + kiểm tài khoản nhận. Số tài khoản bỏ khoảng trắng/gạch, chỉ chữ số 6–24 ký tự. */
export function normalizeBankDetails(input: Partial<BankDetails>): BankDetails {
  const bankName = (input.bankName ?? '').trim().replace(/\s+/g, ' ');
  const accountNumber = (input.accountNumber ?? '').replace(/[\s.-]/g, '');
  const accountName = (input.accountName ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (bankName.length < 2) throw new BadRequestException('Vui lòng nhập tên ngân hàng nhận tiền hoàn.');
  if (!/^\d{6,24}$/.test(accountNumber)) {
    throw new BadRequestException('Số tài khoản nhận tiền hoàn chỉ gồm chữ số, từ 6 đến 24 số.');
  }
  if (accountName.length < 2) throw new BadRequestException('Vui lòng nhập tên chủ tài khoản nhận tiền hoàn.');
  return { bankName, accountNumber, accountName };
}

/**
 * Nơi nhận theo lựa chọn của khách. Không chọn = Ví (hành vi cũ, app bản cũ không gửi trường này). Chọn ngân hàng cho
 * đơn trả bằng Ví/XU thì từ chối thay vì lặng lẽ đổi đích.
 */
export function parseRefundDestination(input: RefundDestinationInput | undefined, paymentMethod: PaymentMethod | string): RefundDestination {
  if (!input?.refundMethod || input.refundMethod === 'WALLET') return WALLET_DESTINATION;
  if (!canRefundToBank(paymentMethod)) {
    throw new BadRequestException('Đơn thanh toán bằng Ví Tubu được hoàn về Ví Tubu.');
  }
  return { method: 'BANK', bank: normalizeBankDetails(input) };
}

/** "Techcombank ••• 6789" — đủ để khách nhận ra tài khoản mà không lộ cả số trong thông báo. */
export function maskedBank(bank: { bankName?: string | null; bankAccountNo?: string | null }): string {
  const no = bank.bankAccountNo ?? '';
  return `${bank.bankName ?? 'ngân hàng'} ••• ${no.slice(-4)}`;
}

export function formatVnd(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}
