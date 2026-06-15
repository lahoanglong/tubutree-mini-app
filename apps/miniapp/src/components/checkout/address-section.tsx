import { useState } from 'react';
import { Box, Text, Button, Input, useSnackbar } from 'zmp-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createAddress, type AddressDTO } from '../../services/shop-api';
import { getErrorMessage } from '../../services/api';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { GeoPicker, EMPTY_GEO, type GeoValue } from '../geo-picker';

/** SĐT Việt Nam: 0xxxxxxxxx hoặc +84xxxxxxxxx (9 số sau đầu số). */
const VN_PHONE = /^(0|\+84)\d{9}$/;

// Tỉnh/phường chọn qua GeoPicker (mã Pancake thật); chỉ 3 field text còn lại.
type FormFields = 'recipient' | 'phone' | 'street';
type FormState = Record<FormFields, string>;

const EMPTY_FORM: FormState = { recipient: '', phone: '', street: '' };

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

interface AddressSectionProps {
  addresses: AddressDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AddressSection({ addresses, selectedId, onSelect }: AddressSectionProps) {
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();

  return (
    <Box p={4} mt={2} style={{ background: 'var(--neutral-0)' }}>
      <Text bold size="small" style={{ marginBottom: 8 }}>
        {vi.checkout.address}
      </Text>

      {addresses.length === 0 && !adding && (
        <Text size="small" style={{ color: 'var(--neutral-400)' }}>
          {vi.checkout.addressEmpty}
        </Text>
      )}

      {addresses.map((a) => (
        <AddressCard key={a.id} address={a} active={selectedId === a.id} onClick={() => onSelect(a.id)} />
      ))}

      {adding ? (
        <AddressForm
          onCancel={() => setAdding(false)}
          onCreated={(a) => {
            void queryClient.invalidateQueries({ queryKey: ['addresses'] });
            onSelect(a.id);
            setAdding(false);
          }}
        />
      ) : (
        <Box
          role="button"
          className="tubu-press"
          onClick={() => {
            haptic('light');
            setAdding(true);
          }}
          style={{
            marginTop: 8,
            padding: '12px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 44,
            boxSizing: 'border-box',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '1.5px dashed var(--primary-600)',
              color: 'var(--primary-600)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            +
          </span>
          <Text size="small" bold style={{ color: 'var(--primary-700)' }}>
            {vi.checkout.addAddress}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function AddressCard({
  address,
  active,
  onClick,
}: {
  address: AddressDTO;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      role="radio"
      aria-checked={active}
      className="tubu-press"
      onClick={() => {
        haptic('light');
        onClick();
      }}
      p={3}
      style={{
        border: `1.5px solid ${active ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
        background: active ? 'var(--primary-50)' : 'var(--neutral-0)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 8,
        minHeight: 44,
        boxSizing: 'border-box',
      }}
    >
      <Box flex alignItems="center" style={{ gap: 6 }}>
        <Text size="small" bold>
          {address.recipient} · {address.phone}
        </Text>
        {address.isDefault && (
          <Text
            size="xSmall"
            style={{
              background: 'var(--leaf-50)',
              color: 'var(--leaf-700)',
              padding: '1px 8px',
              borderRadius: 'var(--radius-full)',
            }}
          >
            {vi.checkout.addressDefault}
          </Text>
        )}
      </Box>
      <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 2 }}>
        {address.street}, {address.ward}, {address.district}, {address.province}
      </Text>
    </Box>
  );
}

function AddressForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (a: AddressDTO) => void;
}) {
  const { openSnackbar } = useSnackbar();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [geo, setGeo] = useState<GeoValue>(EMPTY_GEO);
  const [errors, setErrors] = useState<Partial<Record<FormFields, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<FormFields, boolean>>>({});
  const [geoErr, setGeoErr] = useState<{ province?: string; ward?: string }>({});

  const create = useMutation({
    mutationFn: () =>
      createAddress({
        recipient: form.recipient.trim(),
        phone: form.phone.replace(/\s/g, ''),
        street: form.street.trim(),
        province: geo.province,
        ward: geo.ward,
        district: '', // hệ 2 cấp (Pancake) — không còn quận/huyện
        provinceCode: geo.provinceCode,
        wardCode: geo.wardCode,
        districtCode: '',
      }),
    onSuccess: (a) => {
      haptic('medium');
      onCreated(a);
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
    if (Object.keys(allErrors).length === 0 && Object.keys(gErr).length === 0) create.mutate();
  };

  const renderField = (k: FormFields) => (
    <Box>
      <Input
        label={FIELD_LABEL[k]}
        value={form[k]}
        onChange={setField(k)}
        onBlur={blurField(k)}
        status={touched[k] && errors[k] ? 'error' : undefined}
      />
      {touched[k] && errors[k] && (
        <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 2 }}>
          ⚠ {errors[k]}
        </Text>
      )}
    </Box>
  );

  return (
    <Box style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
      <Box flex style={{ gap: 8, marginTop: 4 }}>
        <Button variant="secondary" onClick={onCancel} style={{ minHeight: 44 }}>
          {vi.common.cancel}
        </Button>
        <Button
          loading={create.isPending}
          onClick={submit}
          style={{ background: 'var(--primary-600)', minHeight: 44, flex: 1 }}
        >
          {vi.common.save}
        </Button>
      </Box>
    </Box>
  );
}
