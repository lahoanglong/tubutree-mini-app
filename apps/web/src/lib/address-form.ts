import type { GeoValue } from '@/components/geo-picker';
import type { AddressDTO } from './shop-client';

export interface AddressFormValues {
  recipient: string;
  phone: string;
  street: string;
}

export type { AddressField, AddressFieldErrors } from '@tubutree/app-core/commerce/checkout-form';
export type AddressPayload = Omit<AddressDTO, 'id' | 'isDefault'>;

export { ADDRESS_FIELD_ORDER, ADDRESS_RECIPIENT_MAX as RECIPIENT_MAX, ADDRESS_STREET_MAX as STREET_MAX } from '@tubutree/app-core/commerce/checkout-form';
export { firstInvalidAddressField as firstInvalidField, validateAddressFields as validateAddress } from '@tubutree/app-core/commerce/checkout-form';

export const normalizePhone = (v: string) => v.replace(/\s/g, '');

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

/**
 * Địa chỉ lưu theo địa giới cũ: mã '00' (trước khi dùng danh mục Pancake) hoặc mã tỉnh hệ 3 cấp (trước sắp xếp
 * 2025). Mã đó không gửi được khi đặt đơn (API trả ADDRESS_OUTDATED) nên phải chọn lại tỉnh/phường.
 */
export function isLegacyGeo(g: { provinceCode?: string | null; wardCode?: string | null }): boolean {
  return !g.provinceCode?.startsWith('84_VN') || !g.wardCode || g.wardCode === '00';
}

/** Sửa địa chỉ địa giới cũ: bỏ trống tỉnh/phường để khách chọn lại theo danh mục mới thay vì lưu lại mã cũ. */
export function addressToForm(a: AddressDTO): { form: AddressFormValues; geo: GeoValue } {
  return {
    form: { recipient: a.recipient, phone: a.phone, street: a.street },
    geo: isLegacyGeo(a)
      ? { province: '', provinceCode: '', ward: '', wardCode: '' }
      : { province: a.province, provinceCode: a.provinceCode, ward: a.ward, wardCode: a.wardCode },
  };
}
