import { useSnackbar } from 'zmp-ui';
import { useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';

/** Đăng nhập Zalo rồi xin số điện thoại (Đổi rác cần cả hai), xong làm mới dữ liệu đổi rác. */
export function useRecycleLogin() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const login = useAuthStore((s) => s.login);
  const ensurePhoneOrThrow = useAuthStore((s) => s.ensurePhoneOrThrow);
  return async () => {
    try {
      await login();
      // Đăng nhập không thành (tài khoản bị khoá, lỗi mạng): nói lý do mà login() đã đặt, đừng mở sheet xin số điện thoại.
      const session = useAuthStore.getState();
      if (session.status !== 'authenticated') {
        if (session.error) openSnackbar({ text: session.error, type: 'error' });
        return;
      }
      await ensurePhoneOrThrow();
      await qc.invalidateQueries({ queryKey: ['waste'] });
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    }
  };
}
