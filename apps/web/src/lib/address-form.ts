import type { GeoValue } from '@/components/geo-picker';
import type { AddressDTO } from './shop-client';

export interface AddressFormValues {
  recipient: string;
  phone: string;
  street: string;
}

export type AddressField = 'recipient' | 'phone' | 'province' | 'ward' | 'street';
export type AddressFieldErrors = Partial<Record<AddressField, string>>;
export type AddressPayload = Omit<AddressDTO, 'id' | 'isDefault'>;

const VN_PHONE = /^(0|\+84)\d{9}$/;
export const RECIPIENT_MAX = 120;
export const STREET_MAX = 255;

/** Thứ tự các ô trên màn hình: ô lỗi đầu tiên nhận con trỏ khi bấm Lưu. */
export const ADDRESS_FIELD_ORDER: readonly AddressField[] = ['recipient', 'phone', 'province', 'ward', 'street'];

export const normalizePhone = (v: string) => v.replace(/\s/g, '');

export function validateAddress(form: AddressFormValues, geo: GeoValue): AddressFieldErrors {
  const e: AddressFieldErrors = {};
  const recipient = form.recipient.trim();
  const street = form.street.trim();
  const phone = normalizePhone(form.phone);
  if (!recipient) e.recipient = 'Nhập tên người nhận.';
  else if (recipient.length > RECIPIENT_MAX) e.recipient = `Tên người nhận tối đa ${RECIPIENT_MAX} ký tự.`;
  if (!phone) e.phone = 'Nhập số điện thoại.';
  else if (!VN_PHONE.test(phone)) e.phone = 'Số điện thoại chưa đúng. Nhập 10 số bắt đầu bằng 0 (hoặc +84 và 9 số).';
  if (!geo.provinceCode) e.province = 'Chọn tỉnh/thành.';
  if (!geo.wardCode) e.ward = 'Chọn phường/xã.';
  if (!street) e.street = 'Nhập số nhà, tên đường.';
  else if (street.length > STREET_MAX) e.street = `Số nhà, tên đường tối đa ${STREET_MAX} ký tự.`;
  return e;
}

export const firstInvalidField = (errors: AddressFieldErrors): AddressField | null =>
  ADDRESS_FIELD_ORDER.find((f) => errors[f]) ?? null;

/** Tỉnh/phường chọn qua GeoPicker theo hệ 2 cấp của Pancake: không còn quận/huyện nên district luôn rỗng. */
export function addressPayload(form: AddressFormValues, geo: GeoValue): AddressPayload {
  return {
    recipient: form.recipient.trim(),
    phone: normalizePhone(form.phone),
    street: form.street.trim(),
    province: geo.province,
    ward: geo.ward,
    district: '',
    provinceCode: geo.provinceCode,
    wardCode: geo.wardCode,
    districtCode: '',
  };
}

export function addressToForm(a: AddressDTO): { form: AddressFormValues; geo: GeoValue } {
  return {
    form: { recipient: a.recipient, phone: a.phone, street: a.street },
    geo: { province: a.province, provinceCode: a.provinceCode, ward: a.ward, wardCode: a.wardCode },
  };
}
