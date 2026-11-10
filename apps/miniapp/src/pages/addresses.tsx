import { useRef, useState } from 'react';
import { Page, useSnackbar } from 'zmp-ui';
import { Plus } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLockedMutation } from '../components/game/use-locked-mutation';
import { getAddresses, type AddressDTO } from '../services/shop-api';
import { updateAddress, deleteAddress } from '../services/account-api';
import { getErrorMessage, getLoadErrorMessage, isStaleStateError } from '../services/api';
import { isHttpError } from '../services/http';
import { haptic } from '../utils/haptic';
import { settleWithin } from '../utils/settle-within';
import { Badge } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { AuthGate } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { addressLine } from '../utils/format';
import { AddressForm } from '../components/address-form';

export default function AddressesPage() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  // Guard auth: tránh gọi /me/addresses khi chưa silent-login xong (mở nhanh từ Hồ sơ ngay
  // lúc app vừa mở → 401 hiện lỗi trong khi chỉ cần chờ vài trăm ms là có phiên).
  const addrQ = useQuery({
    queryKey: ['addresses'],
    queryFn: getAddresses,
    enabled: phase === 'authenticated',
  });

  // Báo giá của trang thanh toán giữ 10 giây: đổi địa chỉ mà không đánh dấu báo giá cũ thì khách quay lại kịp trong 10 giây vẫn thấy phí
  // ship theo địa chỉ trước, đặt đơn thì bị báo tổng tiền đổi.
  const refresh = () => {
    const addresses = qc.invalidateQueries({ queryKey: ['addresses'] });
    void qc.invalidateQueries({ queryKey: ['quote'] });
    return addresses;
  };

  const [editing, setEditing] = useState<AddressDTO | 'new' | null>(null);
  const [confirmDel, setConfirmDel] = useState<AddressDTO | null>(null);

  // "Đặt mặc định" và "Xoá" cùng một địa chỉ loại trừ nhau (đặt mặc định xong mà địa chỉ đã bị xoá thì máy chủ báo lỗi, xoá xong mà vẫn đặt
  // mặc định thì địa chỉ kế tiếp bị chọn nhầm). `isPending` chỉ đúng sau lần vẽ kế tiếp nên khoá bằng ref theo id; khác id vẫn chạy song song.
  // onSuccess trả lời tải lại danh sách: khoá giữ tới khi danh sách mới về (tối đa LOCK_REFRESH_WAIT_MS), không thì thẻ cũ (nhãn mặc định chưa đổi) sáng lại và nhận thêm một lệnh.
  // Địa chỉ vừa xoá thì bị gỡ khỏi cache ngay: lần tải lại có thể bị huỷ bởi lần làm mới của lệnh sau hoặc lỗi mạng, thẻ cũ không được ở lại chờ chúng.
  const acting = useRef(new Set<string>());
  const once = (id: string, run: () => void) => {
    if (acting.current.has(id)) return;
    acting.current.add(id);
    run();
  };
  const release = (_data: unknown, _error: unknown, id: string) => {
    acting.current.delete(id);
  };
  // Máy chủ từ chối vì sổ không còn khớp (địa chỉ đã xoá ở máy khác, đang gắn gói giao định kỳ): tải lại sổ rồi mới nhả khoá, không thì thẻ cũ
  // sáng lại và mỗi cú chạm kế tiếp nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về sổ thật nên giữ nguyên, khách thử lại được ngay.
  const rejected = (e: unknown, id: string) => {
    openSnackbar({ text: getErrorMessage(e), type: 'error' });
    if (!isStaleStateError(e)) return undefined;
    // 404 là địa chỉ không còn nữa: gỡ thẻ ngay như đường xoá thành công, vì lần tải lại có thể bị huỷ hoặc lỗi mạng.
    if (isHttpError(e) && e.response?.status === 404) {
      qc.setQueryData<AddressDTO[]>(['addresses'], (list) => list?.filter((x) => x.id !== id));
      setConfirmDel((cur) => (cur?.id === id ? null : cur));
    }
    return settleWithin(refresh());
  };

  const setDefaultMut = useLockedMutation(
    {
      mutationFn: (id: string) => updateAddress(id, { isDefault: true }),
      onSuccess: () => {
        haptic('light');
        return settleWithin(refresh());
      },
      onError: (e, id) => rejected(e, id),
      onSettled: release,
    },
    (id) => id,
  );

  const deleteMut = useLockedMutation(
    {
      mutationFn: (id: string) => deleteAddress(id),
      onSuccess: (_data, id) => {
        setConfirmDel(null);
        qc.setQueryData<AddressDTO[]>(['addresses'], (list) => list?.filter((x) => x.id !== id));
        openSnackbar({ text: 'Đã xoá địa chỉ.', type: 'success' });
        return settleWithin(refresh());
      },
      onError: (e, id) => rejected(e, id),
      onSettled: release,
    },
    (id) => id,
  );

  const busyOf = (id: string) =>
    (setDefaultMut.isPending && setDefaultMut.variables === id) || (deleteMut.isPending && deleteMut.variables === id);

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Sổ địa chỉ" />

      <AuthGate
        loading={
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton style={{ height: 84, borderRadius: 'var(--radius-card)' }} />
            <Skeleton style={{ height: 84, borderRadius: 'var(--radius-card)' }} />
          </div>
        }
      >
        {addrQ.isLoading ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton style={{ height: 84, borderRadius: 'var(--radius-card)' }} />
            <Skeleton style={{ height: 84, borderRadius: 'var(--radius-card)' }} />
          </div>
        ) : addrQ.isError && !addrQ.data ? (
          <ErrorState message={getLoadErrorMessage(addrQ.error)} onRetry={() => addrQ.refetch()} />
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
                      onClick={() => once(a.id, () => setDefaultMut.mutate(a.id))}
                      busy={busyOf(a.id)}
                    />
                  )}
                  <ActionLink label="Sửa" onClick={() => setEditing(a)} />
                  <ActionLink
                    label="Xoá"
                    danger
                    onClick={() => setConfirmDel(a)}
                    disabled={deleteMut.isPending || busyOf(a.id)}
                  />
                </div>
              </Card>
            ))}

            <Button
              fullWidth
              variant={addrQ.data?.length === 0 ? 'primary' : 'secondary'}
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
      </AuthGate>

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
              void refresh();
              setEditing(null);
            }}
          />
        )}
      </BottomSheet>

      {/* Xác nhận xoá (tránh mất nhầm địa chỉ — thao tác không hoàn tác). */}
      <BottomSheet
        open={confirmDel != null}
        onClose={() => setConfirmDel(null)}
        title="Xoá địa chỉ này?"
        footer={
          confirmDel != null && (
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="secondary" fullWidth onPress={() => setConfirmDel(null)}>
                Huỷ
              </Button>
              <Button
                fullWidth
                variant="danger"
                loading={busyOf(confirmDel.id)}
                onPress={() => once(confirmDel.id, () => deleteMut.mutate(confirmDel.id))}
              >
                Xoá
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
  busy,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Đang gửi: không dùng `disabled` vì Chromium thả focus của nút đang giữ focus khi nó bị vô hiệu; chỉ báo aria-busy, khoá nằm ở `mutate`. */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
      className="tubu-press"
      style={{
        minHeight: 44,
        minWidth: 44,
        padding: '0 8px',
        background: 'none',
        border: 'none',
        font: 'inherit',
        fontSize: 'var(--type-body-sm-size)',
        fontWeight: 600,
        color: danger ? 'var(--color-text-danger)' : 'var(--color-text-brand)',
        opacity: disabled || busy ? 0.5 : 1,
        cursor: disabled || busy ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}
