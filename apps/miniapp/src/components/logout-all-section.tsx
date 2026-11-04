import { useState } from 'react';
import { useSnackbar } from 'zmp-ui';
import { useMutation } from '@tanstack/react-query';
import { api, getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Text } from './ui/text';

/** Đăng xuất mọi thiết bị: máy chủ cắt hết phiên, rồi máy này tự đăng xuất. Lỗi mạng thì giữ nguyên phiên để bấm lại. */
export function LogoutAllSection() {
  const { openSnackbar } = useSnackbar();
  const { logout } = useAuthStore();
  const [confirming, setConfirming] = useState(false);
  const logoutAllM = useMutation({
    mutationFn: () => api.post('/auth/logout-all'),
    onSuccess: () => void logout(),
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  if (!confirming) {
    return (
      <div style={{ padding: '0 16px 16px' }}>
        <Button fullWidth variant="secondary" onPress={() => setConfirming(true)}>
          Đăng xuất mọi thiết bị
        </Button>
      </div>
    );
  }
  return (
    <div style={{ padding: '0 16px 16px' }}>
      <Card padding={16}>
        <Text variant="body-sm" as="p" style={{ fontWeight: 700 }}>
          Đăng xuất khỏi mọi thiết bị?
        </Text>
        <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 4 }}>
          Mọi máy đang đăng nhập tài khoản này, kể cả máy này, sẽ phải đăng nhập lại.
        </Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button variant="secondary" disabled={logoutAllM.isPending} onPress={() => setConfirming(false)} style={{ flex: '0 0 96px' }}>
            Huỷ
          </Button>
          <Button variant="primary" loading={logoutAllM.isPending} onPress={() => logoutAllM.mutate()} style={{ flex: 1 }}>
            Đăng xuất mọi máy
          </Button>
        </div>
      </Card>
    </div>
  );
}
