import { Box, Text, Button, Spinner } from 'zmp-ui';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';

/**
 * Cổng đăng nhập 1 lần (spec §6.1): khi mở app, nếu chưa đăng nhập → màn chào toàn màn
 * với DUY NHẤT 1 nút "Tiếp tục với Zalo" (login + xin SĐT minh bạch). Sau khi vào, không
 * còn nút đăng nhập rải rác ở các trang nữa. Bọc toàn app trong components/app.tsx.
 */
const GRADIENT = 'linear-gradient(155deg, #1E5A2C, #2F7A3C 55%, #95D222)';

/** Logo lá Tubu Tree (trùng motif thumbnail trong design handoff). */
function LeafLogo() {
  return (
    <svg viewBox="0 0 100 100" width={84} height={84} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="100" height="100" rx="24" fill="#fff" />
      <path
        d="M50 74c-16 0-26-11-26-29 0-4 0-7 1-11 12 11 31 11 43-3 7 22 4 43-18 43z"
        fill="#2F7A3C"
      />
    </svg>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const login = useAuthStore((s) => s.login);

  if (status === 'authenticated') return <>{children}</>;

  const loading = status === 'loading';

  return (
    <Box
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: GRADIENT,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'calc(32px + var(--safe-top)) 28px calc(28px + var(--safe-bottom))',
        color: '#fff',
        textAlign: 'center',
      }}
    >
      <Box flex flexDirection="column" alignItems="center" style={{ gap: 14, flex: 1, justifyContent: 'center' }}>
        <LeafLogo />
        <Text bold style={{ color: '#fff', fontSize: 30, letterSpacing: -0.5 }}>
          Tubu Tree
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize: 16, fontWeight: 600 }}>
          Sống xanh An Lành 🌿
        </Text>
      </Box>

      {/* Khối minh bạch quyền + CTA, ghim đáy */}
      <Box style={{ width: '100%', maxWidth: 360 }}>
        <Box
          style={{
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: 16,
            padding: '14px 16px',
            marginBottom: 16,
            textAlign: 'left',
          }}
        >
          <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.95)', lineHeight: 1.5 }}>
            Tubu cần <b>tên</b> &amp; <b>số điện thoại</b> Zalo của bạn để tạo tài khoản, lưu địa chỉ
            nhận hàng và tích điểm Xanh. Chúng mình không chia sẻ thông tin cho bên thứ ba.
          </Text>
        </Box>

        {status === 'error' && (
          <Text size="xSmall" style={{ color: '#FFE08A', marginBottom: 10, display: 'block' }}>
            {error ?? 'Đăng nhập chưa thành công, vui lòng thử lại.'}
          </Text>
        )}

        <Button
          fullWidth
          loading={loading}
          onClick={() => void login()}
          style={{ background: '#fff', color: 'var(--leaf-700)', fontWeight: 700, height: 48 }}
        >
          {loading ? '' : vi.auth.loginCta}
        </Button>

        {loading && (
          <Box flex justifyContent="center" style={{ marginTop: 14 }}>
            <Spinner />
          </Box>
        )}
      </Box>
    </Box>
  );
}
