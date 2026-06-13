import { useState } from 'react';
import { Box, Page, Text, Header, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAddresses, createAddress, type AddressDTO } from '../services/shop-api';
import { updateAddress, deleteAddress } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { Skeleton } from '../components/ui/skeleton';

const VN_PHONE = /^(0|\+84)\d{9}$/;
type FormFields = 'recipient' | 'phone' | 'province' | 'district' | 'ward' | 'street';
type FormState = Record<FormFields, string>;

const EMPTY_FORM: FormState = {
  recipient: '',
  phone: '',
  province: '',
  district: '',
  ward: '',
  street: '',
};
const FIELD_LABEL: Record<FormFields, string> = {
  recipient: vi.checkout.recipient,
  phone: vi.checkout.phone,
  province: vi.checkout.province,
  district: vi.checkout.district,
  ward: vi.checkout.ward,
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

export default function AddressesPage() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses });

  const [editing, setEditing] = useState<AddressDTO | 'new' | null>(null);

  const setDefaultMut = useMutation({
    mutationFn: (id: string) => updateAddress(id, { isDefault: true }),
    onSuccess: () => {
      haptic('light');
      void qc.invalidateQueries({ queryKey: ['addresses'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAddress(id),
    onSuccess: () => {
      openSnackbar({ text: 'Đã xóa địa chỉ.', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['addresses'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title="Sổ địa chỉ" />

      {addrQ.isLoading ? (
        <Box p={4} style={{ gap: 10 }} flex flexDirection="column">
          <Skeleton style={{ height: 84, borderRadius: 12 }} />
          <Skeleton style={{ height: 84, borderRadius: 12 }} />
        </Box>
      ) : addrQ.isError ? (
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--danger)' }}>{getErrorMessage(addrQ.error)}</Text>
        </Box>
      ) : (
        <Box p={4} flex flexDirection="column" style={{ gap: 10 }}>
          {addrQ.data && addrQ.data.length === 0 && (
            <Box style={{ textAlign: 'center', padding: '32px 0' }}>
              <Text style={{ fontSize: 40 }}>📍</Text>
              <Text style={{ color: 'var(--neutral-600)', marginTop: 8 }}>
                Bạn chưa có địa chỉ giao hàng nào.
              </Text>
            </Box>
          )}

          {addrQ.data?.map((a) => (
            <Box
              key={a.id}
              p={3}
              style={{
                background: 'var(--neutral-0)',
                borderRadius: 'var(--radius-lg)',
                border: a.isDefault ? '1.5px solid var(--leaf-600)' : '1px solid var(--neutral-100)',
              }}
            >
              <Box flex alignItems="center" style={{ gap: 6 }}>
                <Text size="small" bold>
                  {a.recipient} · {a.phone}
                </Text>
                {a.isDefault && (
                  <Text
                    size="xSmall"
                    style={{
                      background: 'var(--leaf-50)',
                      color: 'var(--leaf-700)',
                      padding: '1px 8px',
                      borderRadius: 'var(--radius-full)',
                    }}
                  >
                    Mặc định
                  </Text>
                )}
              </Box>
              <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 2 }}>
                {a.street}, {a.ward}, {a.district}, {a.province}
              </Text>

              <Box flex style={{ gap: 16, marginTop: 10 }}>
                {!a.isDefault && (
                  <ActionLink
                    label="Đặt mặc định"
                    onClick={() => setDefaultMut.mutate(a.id)}
                    disabled={setDefaultMut.isPending}
                  />
                )}
                <ActionLink label="Sửa" onClick={() => setEditing(a)} />
                <ActionLink
                  label="Xóa"
                  danger
                  onClick={() => deleteMut.mutate(a.id)}
                  disabled={deleteMut.isPending}
                />
              </Box>
            </Box>
          ))}

          <Button
            fullWidth
            variant="secondary"
            style={{ marginTop: 6 }}
            onClick={() => {
              haptic('light');
              setEditing('new');
            }}
          >
            + Thêm địa chỉ mới
          </Button>
        </Box>
      )}

      <Sheet visible={editing != null} onClose={() => setEditing(null)} autoHeight>
        {editing != null && (
          <AddressForm
            initial={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: ['addresses'] });
              setEditing(null);
            }}
          />
        )}
      </Sheet>
    </Page>
  );
}

function ActionLink({
  label,
  onClick,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Text
      size="small"
      bold
      onClick={disabled ? undefined : onClick}
      style={{
        color: danger ? 'var(--danger)' : 'var(--primary-700)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </Text>
  );
}

function AddressForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: AddressDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          recipient: initial.recipient,
          phone: initial.phone,
          province: initial.province,
          district: initial.district,
          ward: initial.ward,
          street: initial.street,
        }
      : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<Partial<Record<FormFields, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<FormFields, boolean>>>({});

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, phone: form.phone.replace(/\s/g, '') };
      return initial
        ? updateAddress(initial.id, payload)
        : createAddress({ ...payload, provinceCode: '00', districtCode: '00', wardCode: '00' });
    },
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: initial ? 'Đã cập nhật địa chỉ.' : 'Đã thêm địa chỉ.', type: 'success' });
      onSaved();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const setField = (k: FormFields) => (e: { target: { value: string } }) => {
    const next = { ...form, [k]: e.target.value };
    setForm(next);
    if (touched[k]) setErrors(validate(next));
  };
  const blurField = (k: FormFields) => () => {
    setTouched((t) => ({ ...t, [k]: true }));
    setErrors(validate(form));
  };
  const submit = () => {
    const allErrors = validate(form);
    setErrors(allErrors);
    setTouched({ recipient: true, phone: true, province: true, district: true, ward: true, street: true });
    if (Object.keys(allErrors).length === 0) save.mutate();
  };

  return (
    <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
      <Text bold size="large" style={{ marginBottom: 16 }}>
        {initial ? 'Sửa địa chỉ' : 'Thêm địa chỉ'}
      </Text>
      <Box flex flexDirection="column" style={{ gap: 10 }}>
        {(Object.keys(EMPTY_FORM) as FormFields[]).map((k) => (
          <Box key={k}>
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
        ))}
      </Box>
      <Box flex style={{ gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose} style={{ minHeight: 44 }}>
          {vi.common.cancel}
        </Button>
        <Button
          loading={save.isPending}
          onClick={submit}
          style={{ background: 'var(--primary-600)', minHeight: 44, flex: 1 }}
        >
          {vi.common.save}
        </Button>
      </Box>
    </Box>
  );
}
