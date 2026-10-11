import { useState } from 'react';
import { Page, useSnackbar } from 'zmp-ui';
import { Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAddresses, type AddressDTO } from '../services/shop-api';
import { updateAddress, deleteAddress } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { haptic } from '../utils/haptic';
import { Badge } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
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
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Sổ địa chỉ" />

      {authStatus === 'loading' || addrQ.isLoading ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton style={{ height: 84, borderRadius: 'var(--radius-card)' }} />
          <Skeleton style={{ height: 84, borderRadius: 'var(--radius-card)' }} />
        </div>
      ) : addrQ.isError ? (
        <ErrorState message={getErrorMessage(addrQ.error)} onRetry={() => void addrQ.refetch()} />
      ) : (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {addrQ.data && addrQ.data.length === 0 && (
            <EmptyState art="leaf" heading="Bạn chưa có địa chỉ giao hàng nào" />
          )}

          {addrQ.data?.map((a) => (
            <Card
              key={a.id}
              variant="outline"
              style={a.isDefault ? { border: '1.5px solid var(--color-action-primary-bg)' } : undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text variant="body-sm" style={{ fontWeight: 600 }}>
                  {a.recipient} · {a.phone}
                </Text>
                {a.isDefault && (
                  <Badge tone="brand" size="sm">
                    Mặc định
                  </Badge>
                )}
              </div>
              <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
                {addressLine(a)}
              </Text>

              <div style={{ display: 'flex', gap: 8, marginTop: 4, marginLeft: -8 }}>
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
              </div>
            </Card>
          ))}

          <Button
            fullWidth
            variant="secondary"
            icon={Plus}
            style={{ marginTop: 6 }}
            onPress={() => {
              haptic('light');
              setEditing('new');
            }}
          >
            Thêm địa chỉ mới
          </Button>
        </div>
      )}

      <BottomSheet
        open={editing != null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Thêm địa chỉ' : 'Sửa địa chỉ'}
      >
        {editing != null && (
          <AddressForm
            initial={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: ['addresses'] });
              setEditing(null);
            }}
          />
        )}
      </BottomSheet>

      {/* Xác nhận xóa (tránh mất nhầm địa chỉ — thao tác không hoàn tác). */}
      <BottomSheet
        open={confirmDel != null}
        onClose={() => setConfirmDel(null)}
        title="Xóa địa chỉ này?"
        footer={
          confirmDel != null && (
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="secondary" fullWidth onPress={() => setConfirmDel(null)}>
                Hủy
              </Button>
              <Button
                fullWidth
                variant="danger"
                loading={deleteMut.isPending}
                onPress={() => deleteMut.mutate(confirmDel.id)}
              >
                Xóa
              </Button>
            </div>
          )
        }
      >
        {confirmDel != null && (
          <Text variant="body-sm" tone="secondary" as="div">
            {addressLine(confirmDel)}
          </Text>
        )}
      </BottomSheet>
    </Page>
  );
}

/** Nút chữ trong thẻ địa chỉ: thẻ <button> thật để có vai trò + bàn phím, cao 44px cho vùng chạm. */
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="tubu-press"
      style={{
        minHeight: 44,
        padding: '0 8px',
        background: 'none',
        border: 'none',
        font: 'inherit',
        fontSize: 'var(--type-body-sm-size)',
        fontWeight: 600,
        color: danger ? 'var(--color-text-danger)' : 'var(--color-text-brand)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}
