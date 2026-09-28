import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSnackbar, Input } from 'zmp-ui';
import { createAddress, type AddressDTO } from '../services/shop-api';
import { updateAddress } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { GeoPicker, EMPTY_GEO, type GeoValue } from './geo-picker';
import { Field } from './ui/form';
import { Button } from './ui/button';

// Tỉnh/phường chọn qua GeoPicker (mã Pancake thật); chỉ 3 field text còn lại.
type FormFields = 'recipient' | 'phone' | 'street';
type FormState = Record<FormFields, string>;
const EMPTY_FORM: FormState = { recipient: '', phone: '', street: '' };
/** SĐT Việt Nam: 0xxxxxxxxx hoặc +84xxxxxxxxx (9 số sau đầu số). */
const VN_PHONE = /^(0|\+84)\d{9}$/;
const FIELD_LABEL: Record<FormFields, string> = {
  recipient: vi.checkout.recipient,
  phone: vi.checkout.phone,
  street: vi.checkout.street,
};

function validate(form: FormState): Partial<Record<FormFields, string>> {
  const errors: Partial<Record<FormFields, string>> = {};
  (Object.keys(form) as FormFields[]).forEach((k) => {
    if (!form[k].trim()) errors[k] = vi.checkout.requiredField;
  });
  if (form.phone.trim() && !VN_PHONE.test(form.phone.replace(/\s/g, ''))) {
    errors.phone = vi.checkout.phoneInvalid;
  }
  return errors;
}
function validateGeo(g: GeoValue): { province?: string; ward?: string } {
  const e: { province?: string; ward?: string } = {};
  if (!g.provinceCode) e.province = vi.checkout.requiredField;
  if (!g.wardCode) e.ward = vi.checkout.requiredField;
  return e;
}

export interface AddressFormProps {
  initial?: AddressDTO | null;
  onCancel: () => void;
  onSaved: (a: AddressDTO) => void;
}

/**
 * Form địa chỉ dùng chung cho cả checkout (tạo mới, hiển thị inline) và sổ địa chỉ (tạo/sửa,
 * hiển thị trong sheet) — trước đây 2 bản gần như trùng byte-for-byte ở
 * checkout/address-section.tsx và pages/addresses.tsx (audit A4-19). `initial` quyết định
 * create/edit; phần header + sheet bao ngoài vẫn do trang gọi tự vẽ, form này CHỈ vẽ các field.
 */
export function AddressForm({ initial, onCancel, onSaved }: AddressFormProps) {
  const { openSnackbar } = useSnackbar();
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState<FormState>(
    initial
      ? { recipient: initial.recipient, phone: initial.phone, street: initial.street }
      : // Địa chỉ mới: điền sẵn tên + SĐT lấy từ tài khoản Zalo (spec §6.1) để bớt thao tác.
        { ...EMPTY_FORM, recipient: user?.fullName ?? '', phone: user?.phone ?? '' },
  );
  // Prefill địa giới chỉ khi mã hợp lệ (địa chỉ cũ '00' → buộc chọn lại để có mã Pancake thật).
  const [geo, setGeo] = useState<GeoValue>(
    initial && initial.provinceCode && initial.provinceCode !== '00'
      ? {
          province: initial.province,
          provinceCode: initial.provinceCode,
          ward: initial.ward,
          wardCode: initial.wardCode && initial.wardCode !== '00' ? initial.wardCode : '',
        }
      : EMPTY_GEO,
  );
  const [errors, setErrors] = useState<Partial<Record<FormFields, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<FormFields, boolean>>>({});
  const [geoErr, setGeoErr] = useState<{ province?: string; ward?: string }>({});

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        recipient: form.recipient.trim(),
        phone: form.phone.replace(/\s/g, ''),
        street: form.street.trim(),
        province: geo.province,
        ward: geo.ward,
        district: '', // hệ 2 cấp (Pancake) — không còn quận/huyện
        provinceCode: geo.provinceCode,
        wardCode: geo.wardCode,
        districtCode: '',
      };
      return initial ? updateAddress(initial.id, payload) : createAddress(payload);
    },
    onSuccess: (a) => {
      haptic('medium');
      openSnackbar({ text: initial ? 'Đã cập nhật địa chỉ.' : 'Đã thêm địa chỉ.', type: 'success' });
      onSaved(a);
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const setField = (k: FormFields) => (e: { target: { value: string } }) => {
    const next = { ...form, [k]: e.target.value };
    setForm(next);
    // Validate lại ngay khi user sửa field đã chạm — lỗi biến mất tức thì khi sửa đúng.
    if (touched[k]) setErrors(validate(next));
  };
  const blurField = (k: FormFields) => () => {
    setTouched((t) => ({ ...t, [k]: true }));
    setErrors(validate(form));
  };
  const submit = () => {
    const allErrors = validate(form);
    const gErr = validateGeo(geo);
    setErrors(allErrors);
    setGeoErr(gErr);
    setTouched({ recipient: true, phone: true, street: true });
    if (Object.keys(allErrors).length === 0 && Object.keys(gErr).length === 0) save.mutate();
  };
  const renderField = (k: FormFields) => (
    <Field label={FIELD_LABEL[k]} error={touched[k] ? errors[k] : undefined}>
      <Input
        value={form[k]}
        onChange={setField(k)}
        onBlur={blurField(k)}
        inputMode={k === 'phone' ? 'numeric' : undefined}
        status={touched[k] && errors[k] ? 'error' : undefined}
      />
    </Field>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {renderField('recipient')}
      {renderField('phone')}
      <GeoPicker
        value={geo}
        onChange={(g) => {
          setGeo(g);
          setGeoErr(validateGeo(g));
        }}
        errorProvince={geoErr.province}
        errorWard={geoErr.ward}
      />
      {renderField('street')}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button variant="secondary" onPress={onCancel}>
          {vi.common.cancel}
        </Button>
        {/* disabled cũng đọc save.isPending (không chỉ loading): Button (Task 10) không tự chặn
        onPress khi đang loading — chỉ disabled=true mới thật sự chặn double-tap (button-guard.spec.ts).
        Spinner vẫn ẩn trong lúc đó (hạn chế hiện tại của Button khi loading+disabled cùng true) —
        đổi lại tránh gọi tạo/sửa địa chỉ 2 lần, quan trọng hơn ở form này. */}
        <Button loading={save.isPending} disabled={save.isPending} onPress={submit} fullWidth>
          {vi.common.save}
        </Button>
      </div>
    </div>
  );
}
