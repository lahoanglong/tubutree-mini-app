import { useSnackbar } from 'zmp-ui';
import { useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';

/** Đăng nhập Zalo rồi xin số điện thoại (Đổi rác cần cả hai), xong làm mới dữ liệu đổi rác. */
export function useRecycleLogin() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const login = useAuthStore((s) => s.login);
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  return async () => {
    try {
      await login();
      await ensurePhone();
      await qc.invalidateQueries({ queryKey: ['waste'] });
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
    }
  };
}
