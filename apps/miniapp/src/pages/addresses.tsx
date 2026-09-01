import { useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAddresses, createAddress, type AddressDTO } from '../services/shop-api';
import { updateAddress, deleteAddress } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { useAuthStore } from '../store/auth';
import { addressLine } from '../utils/format';
import { GeoPicker, EMPTY_GEO, type GeoValue } from '../components/geo-picker';

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

export default function AddressesPage() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses });

  const [editing, setEditing] = useState<AddressDTO | 'new' | null>(null);
  const [confirmDel, setConfirmDel] = useState<AddressDTO | null>(null);

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
      setConfirmDel(null);
      openSnackbar({ text: 'Đã xóa địa chỉ.', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['addresses'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      {addrQ.isLoading ? (
        <Box p={4} style={{ gap: 10 }} flex flexDirection="column">
          <Skeleton style={{ height: 84, borderRadius: 12 }} />
          <Skeleton style={{ height: 84, borderRadius: 12 }} />
        </Box>
      ) : addrQ.isError ? (
        <ErrorState message={getErrorMessage(addrQ.error)} onRetry={() => void addrQ.refetch()} />
      ) : (
        <Box p={4} flex flexDirection="column" style={{ gap: 10 }}>
          {addrQ.data && addrQ.data.length === 0 && (
            <EmptyState art="leaf" heading="Bạn chưa có địa chỉ giao hàng nào" />
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
                {addressLine(a)}
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
                  onClick={() => setConfirmDel(a)}
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

      {/* Xác nhận xóa (tránh mất nhầm địa chỉ — thao tác không hoàn tác). */}
      <Sheet visible={confirmDel != null} onClose={() => setConfirmDel(null)} autoHeight>
        {confirmDel != null && (
          <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
            <Text bold size="large">
              Xóa địa chỉ này?
            </Text>
            <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
              {addressLine(confirmDel)}
            </Text>
            <Box flex style={{ gap: 10, marginTop: 16 }}>
              <Button variant="secondary" fullWidth onClick={() => setConfirmDel(null)}>
                Hủy
              </Button>
              <Button
                fullWidth
                loading={deleteMut.isPending}
                disabled={deleteMut.isPending}
                onClick={() => deleteMut.mutate(confirmDel.id)}
                style={{ background: 'var(--danger)' }}
              >
                Xóa
              </Button>
            </Box>
          </Box>
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
        district: '', // hệ 2 cấp (Pancake)
        provinceCode: geo.provinceCode,
        wardCode: geo.wardCode,
        districtCode: '',
      };
      return initial ? updateAddress(initial.id, payload) : createAddress(payload);
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
    const gErr = validateGeo(geo);
    setErrors(allErrors);
    setGeoErr(gErr);
    setTouched({ recipient: true, phone: true, street: true });
    if (Object.keys(allErrors).length === 0 && Object.keys(gErr).length === 0) save.mutate();
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
    <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
      <Text bold size="large" style={{ marginBottom: 16 }}>
        {initial ? 'Sửa địa chỉ' : 'Thêm địa chỉ'}
      </Text>
      <Box flex flexDirection="column" style={{ gap: 10 }}>
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
