import { useSnackbar } from 'zmp-ui';
import { useAuthStore } from '../store/auth';

/**
 * Nút "đăng nhập" nằm giữa màn đang dùng (không có chỗ để đổi cả màn): đăng nhập xong mà tài khoản bị khoá thì nói lời máy chủ
 * bằng thanh thông báo, nếu không nút bấm xong im lặng và khách tưởng app hỏng.
 */
export function useLoginWithNotice() {
  const { openSnackbar } = useSnackbar();
  const login = useAuthStore((s) => s.login);
  return async () => {
    await login();
    const { status, error } = useAuthStore.getState();
    if (status === 'idle' && error) openSnackbar({ text: error, type: 'error' });
  };
}
