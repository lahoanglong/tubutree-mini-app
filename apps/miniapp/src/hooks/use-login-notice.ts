import { useSnackbar } from 'zmp-ui';
import { useAuthStore } from '../store/auth';

/**
 * Nút "đăng nhập" nằm giữa màn đang dùng (không có chỗ để đổi cả màn): đăng nhập xong mà tài khoản bị khoá, mất mạng hay bị giới
 * hạn tốc độ thì nói bằng thanh thông báo, nếu không nút bấm xong im lặng và khách tưởng app hỏng.
 * `sessionErrorShown`: màn tự đổi sang SessionUnavailable khi phiên lỗi (Vườn, Cộng đồng) thì không báo lỗi phiên thêm lần nữa.
 * File riêng (không nằm trong auth-gate) vì tim yêu thích ở entry dùng hook này: import auth-gate sẽ kéo cả màn chờ/màn lỗi vào entry.
 */
export function useLoginWithNotice({ sessionErrorShown = false }: { sessionErrorShown?: boolean } = {}) {
  const { openSnackbar } = useSnackbar();
  const login = useAuthStore((s) => s.login);
  return async () => {
    await login();
    const { status, error } = useAuthStore.getState();
    if (!error) return;
    if (status === 'idle' || (status === 'error' && !sessionErrorShown)) openSnackbar({ text: error, type: 'error' });
  };
}
