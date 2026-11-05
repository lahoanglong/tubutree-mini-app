import { fillCopy } from '../shop-copy';
import { isTaxCodeValid } from './tax-code';

/**
 * Kiểm các ô nhập của màn thanh toán (địa chỉ giao và hoá đơn VAT) cho Mini App và web: cùng luật, cùng câu, cùng thứ tự ô.
 * Mỗi ô một câu riêng để lời báo nằm ngay dưới ô sai; thứ tự ô là thứ tự trên màn hình để ô lỗi đầu tiên nhận con trỏ.
 */

export type AddressField = 'recipient' | 'phone' | 'province' | 'ward' | 'street';
export type AddressFieldErrors = Partial<Record<AddressField, string>>;

export interface AddressFormValues {
  recipient: string;
  phone: string;
  street: string;
}

export interface AddressGeoCodes {
  provinceCode?: string | null;
  wardCode?: string | null;
}

// Cùng luật với CreateAddressDto ở API (address.dto.ts): SĐT VN, không ký tự < > trong tên/địa chỉ.
const VN_PHONE = /^(0|\+84)\d{9}$/;
const HTML_CHARS = /[<>]/;
export const ADDRESS_RECIPIENT_MAX = 120;
export const ADDRESS_STREET_MAX = 255;

export const ADDRESS_FIELD_ORDER: readonly AddressField[] = ['recipient', 'phone', 'province', 'ward', 'street'];

export function validateAddressFields(form: AddressFormValues, geo: AddressGeoCodes): AddressFieldErrors {
  const e: AddressFieldErrors = {};
  const recipient = form.recipient.trim();
  const street = form.street.trim();
  const phone = form.phone.replace(/\s/g, '');
  if (!recipient) e.recipient = 'Nhập tên người nhận.';
  else if (recipient.length > ADDRESS_RECIPIENT_MAX) e.recipient = `Tên người nhận tối đa ${ADDRESS_RECIPIENT_MAX} ký tự.`;
  else if (HTML_CHARS.test(recipient)) e.recipient = 'Tên người nhận không được chứa ký tự < hoặc >.';
  if (!phone) e.phone = 'Nhập số điện thoại.';
  else if (!VN_PHONE.test(phone)) e.phone = 'Số điện thoại chưa đúng. Nhập 10 số bắt đầu bằng 0 (hoặc +84 và 9 số).';
  if (!geo.provinceCode) e.province = 'Chọn tỉnh/thành.';
  if (!geo.wardCode) e.ward = 'Chọn phường/xã.';
  if (!street) e.street = 'Nhập số nhà, tên đường.';
  else if (street.length > ADDRESS_STREET_MAX) e.street = `Số nhà, tên đường tối đa ${ADDRESS_STREET_MAX} ký tự.`;
  else if (HTML_CHARS.test(street)) e.street = 'Địa chỉ không được chứa ký tự < hoặc >.';
  return e;
}

export const firstInvalidAddressField = (errors: AddressFieldErrors): AddressField | null =>
  ADDRESS_FIELD_ORDER.find((f) => errors[f]) ?? null;

export type InvoiceField = 'taxCode' | 'companyName' | 'address' | 'email';
export type InvoiceFieldErrors = Partial<Record<InvoiceField, string>>;

export interface InvoiceFormValues {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}

export const INVOICE_FIELD_ORDER: readonly InvoiceField[] = ['taxCode', 'companyName', 'address', 'email'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateInvoiceFields(invoice: InvoiceFormValues): InvoiceFieldErrors {
  const e: InvoiceFieldErrors = {};
  if (!invoice.taxCode.trim()) e.taxCode = 'Nhập mã số thuế.';
  else if (!isTaxCodeValid(invoice.taxCode)) e.taxCode = fillCopy('checkout.taxCodeInvalid');
  if (!invoice.companyName.trim()) e.companyName = 'Nhập tên công ty.';
  if (!invoice.address.trim()) e.address = 'Nhập địa chỉ xuất hoá đơn.';
  if (!invoice.email.trim()) e.email = 'Nhập email nhận hoá đơn.';
  else if (!EMAIL_RE.test(invoice.email.trim())) e.email = 'Email chưa đúng. Ví dụ: ten@congty.vn.';
  return e;
}

export const firstInvalidInvoiceField = (errors: InvoiceFieldErrors): InvoiceField | null =>
  INVOICE_FIELD_ORDER.find((f) => errors[f]) ?? null;
