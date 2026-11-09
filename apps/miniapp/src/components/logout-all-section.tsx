import { useState } from 'react';
import { useSnackbar } from 'zmp-ui';
import { useMutation } from '@tanstack/react-query';
import { api, getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Button } from './ui/button';
import { ConfirmSheet } from './ui/confirm-sheet';

/** Đăng xuất mọi thiết bị: máy chủ cắt hết phiên, rồi máy này tự đăng xuất. Lỗi mạng thì giữ nguyên phiên để bấm lại. */
export function LogoutAllSection() {
  const { openSnackbar } = useSnackbar();
  const { logout } = useAuthStore();
  const [confirming, setConfirming] = useState(false);
  const logoutAllM = useMutation({
    mutationFn: () => api.post('/auth/logout-all'),
    onSuccess: () => void logout(),
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      setConfirming(false);
    },
  });

  return (
    <>
      <Button fullWidth variant="secondary" disabled={logoutAllM.isPending} onPress={() => setConfirming(true)}>
        Đăng xuất mọi thiết bị
      </Button>
      <ConfirmSheet
        open={confirming}
        title="Đăng xuất khỏi mọi thiết bị?"
        message="Mọi máy đang đăng nhập tài khoản này, kể cả máy này, sẽ phải đăng nhập lại."
        confirmLabel="Đăng xuất mọi máy"
        loading={logoutAllM.isPending}
        onConfirm={() => {
          if (logoutAllM.isPending) return;
          logoutAllM.mutate();
        }}
        onCancel={() => {
          if (logoutAllM.isPending) return;
          setConfirming(false);
        }}
      />
    </>
  );
}
