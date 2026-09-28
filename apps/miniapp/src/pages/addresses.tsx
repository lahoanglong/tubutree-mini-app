import { useState } from 'react';
import { Box, Page, Text, Button, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAddresses, type AddressDTO } from '../services/shop-api';
import { updateAddress, deleteAddress } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { haptic } from '../utils/haptic';
import { Skeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { useAuthStore } from '../store/auth';
import { addressLine } from '../utils/format';
import { AddressForm } from '../components/address-form';

export default function AddressesPage() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const authStatus = useAuthStore((s) => s.status);
  // Guard auth: tránh gọi /me/addresses khi chưa silent-login xong (mở nhanh từ Hồ sơ ngay
  // lúc app vừa mở → 401 hiện lỗi trong khi chỉ cần chờ vài trăm ms là có phiên).
  const addrQ = useQuery({
    queryKey: ['addresses'],
    queryFn: getAddresses,
    enabled: authStatus === 'authenticated',
  });

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

      {authStatus === 'loading' || addrQ.isLoading ? (
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
          <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
            <Text bold size="large" style={{ marginBottom: 16 }}>
              {editing === 'new' ? 'Thêm địa chỉ' : 'Sửa địa chỉ'}
            </Text>
            <AddressForm
              initial={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                setEditing(null);
              }}
            />
          </Box>
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
