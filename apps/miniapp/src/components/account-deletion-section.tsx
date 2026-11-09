import { useState } from 'react';
import { useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getWallet, requestAccountDeletion } from '../services/account-api';
import {
  WALLET_FORFEIT_AGREE,
  WALLET_FORFEIT_LOADING,
  WALLET_FORFEIT_UNKNOWN,
  canSubmitDeletion,
  walletForfeitConsent,
  walletForfeitNotice,
} from '../utils/account-deletion-copy';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { openOAChat, hasOA } from '../services/zmp-bridge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Checkbox } from './ui/form';
import { ListRow } from './ui/list-row';
import { Text } from './ui/text';

/** Khối Xoá tài khoản ở Cài đặt: gửi yêu cầu thật, CSKH xác minh rồi xử lý, không xoá ngay. */
export function AccountDeletionSection() {
  const { openSnackbar } = useSnackbar();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [agreedBalance, setAgreedBalance] = useState<number | null>(null);
  const qc = useQueryClient();
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: confirmDelete });
  const walletBalance = walletQ.data?.walletBalance;
  // Tick gắn với số dư khách đã thấy lúc tick: ví tải lại ra số khác thì tick cũ hết hiệu lực, không gửi kèm số mới.
  const forfeitAgreed = walletBalance !== undefined && agreedBalance === walletBalance;

  // Ghi nhận yêu cầu thật (CSKH xử lý thủ công, không xoá ngay) và mở sẵn Zalo OA để khách trao đổi luôn.
  const deleteM = useMutation({
    mutationFn: () => requestAccountDeletion(undefined, walletForfeitConsent(walletBalance, forfeitAgreed)),
    onSuccess: (res) => {
      openSnackbar({ text: res.message, type: 'info' });
      if (hasOA) void openOAChat('Tôi muốn xoá tài khoản Tubu Tree');
      setAgreedBalance(null);
      setConfirmDelete(false);
    },
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      setAgreedBalance(null);
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
  const busy = deleteM.isPending;

  return (
    <div style={{ margin: '12px 16px 0' }}>
      {!confirmDelete ? (
        <ListRow
          destructive
          title="Xoá tài khoản"
          onPress={() => {
            deleteM.reset();
            setConfirmDelete(true);
          }}
          style={{ justifyContent: 'center', textAlign: 'center' }}
        />
      ) : (
        <div role="region" aria-label="Xác nhận xoá tài khoản" aria-busy={walletQ.isLoading || busy || undefined}>
          <Card padding={16} style={{ background: 'var(--color-status-danger-bg)' }}>
            <Text variant="body-sm" tone="danger" as="p" style={{ fontWeight: 700 }}>
              Xoá tài khoản vĩnh viễn?
            </Text>
            <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 4 }}>
              Gửi yêu cầu để CSKH liên hệ xác minh và xử lý xoá tài khoản theo quy định — tài khoản CHƯA bị xoá ngay khi
              bạn bấm nút này.
            </Text>
            {deleteM.isError && (
              <div role="alert" style={{ marginTop: 'var(--space-stack-sm)' }}>
                <Text variant="caption" tone="danger" as="p">
                  {getErrorMessage(deleteM.error)}
                </Text>
              </div>
            )}
            {walletQ.isLoading && (
              <div role="status" style={{ marginTop: 8 }}>
                <Text variant="caption" tone="secondary" as="p">
                  {WALLET_FORFEIT_LOADING}
                </Text>
              </div>
            )}
            {walletQ.isError && (
              <div role="alert" style={{ marginTop: 8 }}>
                <Text variant="caption" tone="danger" as="p">
                  {WALLET_FORFEIT_UNKNOWN}
                </Text>
              </div>
            )}
            {walletBalance !== undefined && walletBalance > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text variant="body-sm" as="p" numeric style={{ fontWeight: 700 }}>
                  {walletForfeitNotice(formatVnd(walletBalance))}
                </Text>
                <div style={{ marginTop: 8 }}>
                  <Checkbox
                    checked={forfeitAgreed}
                    disabled={busy}
                    onChange={() => {
                      if (busy) return;
                      setAgreedBalance(forfeitAgreed ? null : walletBalance);
                    }}
                    label={WALLET_FORFEIT_AGREE}
                  />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  if (busy) return;
                  deleteM.reset();
                  setConfirmDelete(false);
                  setAgreedBalance(null);
                }}
                style={{ flex: '0 0 96px' }}
              >
                Huỷ
              </Button>
              <Button
                variant="danger"
                loading={busy}
                disabled={!canSubmitDeletion(walletBalance, forfeitAgreed)}
                onPress={() => {
                  if (busy) return;
                  deleteM.mutate();
                }}
                style={{ flex: 1 }}
              >
                Gửi yêu cầu xoá
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
