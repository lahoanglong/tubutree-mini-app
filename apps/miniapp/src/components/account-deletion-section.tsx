import { useState } from 'react';
import { useSnackbar } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWallet, requestAccountDeletion } from '../services/account-api';
import {
  WALLET_FORFEIT_AGREE,
  WALLET_FORFEIT_LOADING,
  WALLET_FORFEIT_UNKNOWN,
  canSubmitDeletion,
  walletForfeitConsent,
  walletForfeitNotice,
} from '../utils/account-deletion-copy';
import { getErrorMessage, isStaleStateError, isTargetGoneError } from '../services/api';
import { formatVnd } from '../utils/format';
import { settleWithin } from '../utils/settle-within';
import { openOAChat, hasOA } from '../services/zmp-bridge';
import { useLockedMutation } from './game/use-locked-mutation';
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
  // Đồng ý bỏ số dư gắn với đúng số tiền khách đã thấy: số dư đổi (Thử lại, tải lại khi quay về app) thì phải tick lại.
  const forfeitAgreed = walletBalance !== undefined && agreedBalance === walletBalance;
  // Truy vấn lỗi mà chưa có số dư bị react-query đặt về pending lúc tải lại và xoá lỗi; giữ vùng lỗi + nút Thử lại đứng yên
  // (không mất focus) tới khi lượt tải lại có kết quả.
  const [walletRetrying, setWalletRetrying] = useState(false);
  const walletWaiting = walletRetrying && walletQ.isPending;

  // Ghi nhận yêu cầu thật (CSKH xử lý thủ công, không xoá ngay) và mở sẵn Zalo OA để khách trao đổi luôn.
  const deleteM = useLockedMutation({
    mutationFn: () => requestAccountDeletion(undefined, walletForfeitConsent(walletBalance, forfeitAgreed)),
    onSuccess: (res) => {
      openSnackbar({ text: res.message, type: 'info' });
      if (hasOA) void openOAChat('Tôi muốn xoá tài khoản Tubu Tree');
      setConfirmDelete(false);
      setWalletRetrying(false);
    },
    // Mọi lỗi đều bỏ tick và tải lại số dư (lần gửi hết thời gian có thể đã ghi số dư mới). Máy chủ từ chối vì số dư không còn khớp (400/404/409) thì
    // giữ khoá tới khi số dư mới về, để ô đồng ý và nút gửi không mở lại theo số cũ; lỗi tạm thì nhả ngay để khách gửi lại.
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      setAgreedBalance(null);
      const refreshed = qc.invalidateQueries({ queryKey: ['wallet'] });
      if (!isStaleStateError(e)) {
        void refreshed;
        return undefined;
      }
      const held = settleWithin(refreshed);
      // Thẻ có ô đồng ý bỏ số dư: chỉ thu lại khi tài khoản không còn hoặc vừa đổi (404/409), sau khi số dư mới về; 400 là số dư lệch, khách tick lại đúng số mới ngay trên thẻ này.
      // Huỷ bị khoá suốt lúc lệnh bay và lúc giữ khoá nên thẻ này vẫn đúng là thẻ của lệnh vừa bị từ chối.
      return isTargetGoneError(e)
        ? held.then(() => {
            setConfirmDelete(false);
            setWalletRetrying(false);
          })
        : held;
    },
  });

  return (
    <div style={{ margin: '12px 16px 0' }}>
      {!confirmDelete ? (
        <ListRow
          destructive
          title="Xoá tài khoản"
          onPress={() => setConfirmDelete(true)}
          style={{ justifyContent: 'center', textAlign: 'center' }}
        />
      ) : (
        <Card padding={16} style={{ background: 'var(--color-status-danger-bg)' }}>
          <Text variant="body-sm" tone="danger" as="p" style={{ fontWeight: 700 }}>
            Xoá tài khoản vĩnh viễn?
          </Text>
          <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 4 }}>
            Gửi yêu cầu để CSKH liên hệ xác minh và xử lý xoá tài khoản theo quy định — tài khoản CHƯA bị xoá ngay khi
            bạn bấm nút này.
          </Text>
          {walletQ.isLoading && !walletWaiting && (
            <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 8 }}>
              {WALLET_FORFEIT_LOADING}
            </Text>
          )}
          {walletQ.isError || walletWaiting ? (
            <div role="alert" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Text variant="caption" tone="danger" as="p" style={{ flex: 1, minWidth: 0 }}>
                {WALLET_FORFEIT_UNKNOWN}
              </Text>
              <Button
                variant="secondary"
                loading={walletQ.isFetching}
                disabled={deleteM.isPending}
                onPress={() => {
                  setWalletRetrying(true);
                  return walletQ.refetch();
                }}
              >
                Thử lại
              </Button>
            </div>
          ) : null}
          {walletBalance !== undefined && walletBalance > 0 && (
            <div style={{ marginTop: 12 }}>
              <Text variant="body-sm" as="p" numeric style={{ fontWeight: 700 }}>
                {walletForfeitNotice(formatVnd(walletBalance))}
              </Text>
              <div style={{ marginTop: 8 }}>
                <Checkbox
                  checked={forfeitAgreed}
                  disabled={deleteM.isPending}
                  onChange={() => setAgreedBalance(forfeitAgreed ? null : walletBalance)}
                  label={WALLET_FORFEIT_AGREE}
                />
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button
              variant="secondary"
              disabled={deleteM.isPending}
              onPress={() => {
                if (deleteM.isPending) return;
                setConfirmDelete(false);
                setAgreedBalance(null);
                setWalletRetrying(false);
              }}
              style={{ flex: '0 0 96px' }}
            >
              Huỷ
            </Button>
            <Button
              variant="danger"
              loading={deleteM.isPending}
              disabled={!canSubmitDeletion(walletBalance, forfeitAgreed)}
              onPress={() => deleteM.mutate()}
              style={{ flex: 1 }}
            >
              Gửi yêu cầu xoá
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
