import { Box, Page, Text, Button, Header, Avatar } from 'zmp-ui';
import { useAuthStore } from '../store/auth';
import { formatVnd } from '../utils/format';

export default function ProfilePage() {
  const { user, status, login, logout } = useAuthStore();

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title="Tài khoản" showBackIcon={false} />

      {status === 'authenticated' && user ? (
        <>
          <Box
            p={4}
            flex
            alignItems="center"
            style={{ gap: 12, background: 'var(--neutral-0)' }}
          >
            <Avatar size={56} src={user.avatarUrl ?? undefined} />
            <Box>
              <Text bold>{user.fullName ?? 'Khách Tubu'}</Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                Mã giới thiệu: {user.referralCode}
              </Text>
            </Box>
          </Box>

          <Box flex p={3} style={{ gap: 10 }}>
            <Stat label="Điểm Xanh" value={String(user.pointsBalance)} />
            <Stat label="Ví Tubu" value={formatVnd(user.walletBalance)} />
          </Box>

          <Box p={4}>
            <Button fullWidth variant="secondary" onClick={() => void logout()}>
              Đăng xuất
            </Button>
          </Box>
        </>
      ) : (
        <Box flex flexDirection="column" alignItems="center" p={8} style={{ gap: 12 }}>
          <Text style={{ fontSize: 48 }}>🌿</Text>
          <Text style={{ color: 'var(--neutral-600)' }}>Đăng nhập để tích điểm & mua sắm</Text>
          <Button onClick={() => void login()} style={{ background: 'var(--green-600)' }}>
            Đăng nhập với Zalo
          </Button>
        </Box>
      )}
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box
      p={3}
      style={{ flex: 1, background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}
    >
      <Text bold style={{ color: 'var(--green-700)' }}>
        {value}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {label}
      </Text>
    </Box>
  );
}
