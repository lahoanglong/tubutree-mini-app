import { Box, Page, Text, Button, Header, Avatar, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { getLoyalty, getNotifications } from '../services/account-api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';

interface MenuItem {
  icon: string;
  label: string;
  to: string;
  hint?: string;
}

/**
 * Route đã build xong (điều hướng thật). Mục chưa có trong set → báo "đang hoàn thiện"
 * thay vì điều hướng tới trang trắng. Mở khóa dần theo từng vòng phát triển.
 */
const READY = new Set([
  '/orders',
  '/loyalty',
  '/wallet',
  '/addresses',
  '/notifications',
  '/affiliate',
  '/cashback',
  '/dealer',
]);

const MENU: { group: string; items: MenuItem[] }[] = [
  {
    group: 'Mua sắm',
    items: [
      { icon: '📦', label: 'Đơn hàng của tôi', to: '/orders' },
      { icon: '❤️', label: 'Sản phẩm yêu thích', to: '/wishlist' },
      { icon: '📍', label: 'Sổ địa chỉ', to: '/addresses' },
    ],
  },
  {
    group: 'Tài sản',
    items: [
      { icon: '🌿', label: 'Hạng thành viên & Điểm Xanh', to: '/loyalty' },
      { icon: '👛', label: 'Ví Tubu', to: '/wallet' },
    ],
  },
  {
    group: 'Kiếm thưởng',
    items: [
      { icon: '🤝', label: 'Cộng tác viên', to: '/affiliate', hint: 'Chia sẻ — nhận hoa hồng' },
      { icon: '🛍️', label: 'Hoàn tiền sàn ngoài', to: '/cashback' },
    ],
  },
  {
    group: 'Khác',
    items: [
      { icon: '🔔', label: 'Thông báo', to: '/notifications' },
      { icon: '🏪', label: 'Đăng ký đại lý', to: '/dealer' },
      { icon: 'ℹ️', label: 'Về Tubu Tree & Hỗ trợ', to: '/about' },
    ],
  },
];

export default function ProfilePage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const { user, status, login, logout } = useAuthStore();
  const loyaltyQ = useQuery({
    queryKey: ['loyalty'],
    queryFn: getLoyalty,
    enabled: status === 'authenticated',
  });
  const notifQ = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    enabled: status === 'authenticated',
  });
  const unreadCount = notifQ.data?.filter((n) => n.status !== 'READ').length ?? 0;

  if (status !== 'authenticated' || !user) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Header title="Tài khoản" showBackIcon={false} />
        <Box flex flexDirection="column" alignItems="center" p={8} style={{ gap: 12 }}>
          <Text style={{ fontSize: 48 }}>🌿</Text>
          <Text style={{ color: 'var(--neutral-600)' }}>Đăng nhập để tích điểm & mua sắm</Text>
          <Button onClick={() => void login()} style={{ background: 'var(--leaf-600)' }}>
            Đăng nhập với Zalo
          </Button>
        </Box>
      </Page>
    );
  }

  const tierName = loyaltyQ.data?.tier?.name ?? 'Mầm Xanh';

  const copyReferral = () => {
    haptic('light');
    if (navigator.clipboard && user.referralCode) {
      void navigator.clipboard.writeText(user.referralCode);
      openSnackbar({ text: 'Đã sao chép mã giới thiệu', type: 'success' });
    }
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title="Tài khoản" showBackIcon={false} />

      {/* Header card */}
      <Box
        p={4}
        style={{
          background: 'linear-gradient(135deg, var(--leaf-600), var(--leaf-700))',
          color: '#fff',
        }}
      >
        <Box flex alignItems="center" style={{ gap: 12 }}>
          <Avatar size={56} src={user.avatarUrl ?? undefined} />
          <Box style={{ flex: 1 }}>
            <Text bold style={{ color: '#fff' }}>
              {user.fullName ?? 'Khách Tubu'}
            </Text>
            <Text
              size="xSmall"
              style={{
                display: 'inline-block',
                marginTop: 4,
                background: 'rgba(255,255,255,0.2)',
                padding: '2px 10px',
                borderRadius: 'var(--radius-full)',
                color: '#fff',
              }}
            >
              🌿 {tierName}
            </Text>
          </Box>
        </Box>

        {user.referralCode && (
          <Box
            flex
            alignItems="center"
            justifyContent="space-between"
            mt={3}
            p={2}
            style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 'var(--radius-md)' }}
            onClick={copyReferral}
          >
            <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.9)' }}>
              Mã giới thiệu: <b>{user.referralCode}</b>
            </Text>
            <Text size="xSmall" style={{ color: '#fff' }}>
              Sao chép ⧉
            </Text>
          </Box>
        )}
      </Box>

      {/* Quick stats */}
      <Box flex p={3} style={{ gap: 10, marginTop: -20 }}>
        <Stat
          label="Điểm Xanh"
          value={String(loyaltyQ.data?.pointsBalance ?? user.pointsBalance)}
          onClick={() => navigate('/loyalty')}
        />
        <Stat label="Ví Tubu" value={formatVnd(user.walletBalance)} onClick={() => navigate('/wallet')} />
      </Box>

      {/* Menu */}
      {MENU.map((section) => (
        <Box key={section.group} mx={4} mb={3}>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginBottom: 6, marginLeft: 4 }}>
            {section.group.toUpperCase()}
          </Text>
          <Box style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            {section.items.map((item, i) => (
              <Box
                key={item.to}
                className="tubu-press"
                flex
                alignItems="center"
                p={3}
                style={{
                  gap: 12,
                  minHeight: 48,
                  borderTop: i === 0 ? 'none' : '1px solid var(--neutral-100)',
                }}
                onClick={() => {
                  haptic('light');
                  if (READY.has(item.to)) navigate(item.to);
                  else openSnackbar({ text: 'Tính năng đang được hoàn thiện 🌱', type: 'info' });
                }}
              >
                <Text style={{ fontSize: 20 }}>{item.icon}</Text>
                <Box style={{ flex: 1 }}>
                  <Text size="small">{item.label}</Text>
                  {item.hint && (
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                      {item.hint}
                    </Text>
                  )}
                </Box>
                {item.to === '/notifications' && unreadCount > 0 && (
                  <span
                    style={{
                      minWidth: 18,
                      height: 18,
                      padding: '0 5px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--primary-600)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
                <Text style={{ color: 'var(--neutral-400)' }}>›</Text>
              </Box>
            ))}
          </Box>
        </Box>
      ))}

      <Box p={4}>
        <Button fullWidth variant="secondary" onClick={() => void logout()}>
          Đăng xuất
        </Button>
      </Box>
    </Page>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <Box
      className="tubu-press"
      p={3}
      onClick={onClick}
      style={{
        flex: 1,
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'center',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <Text bold style={{ color: 'var(--leaf-700)' }}>
        {value}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {label}
      </Text>
    </Box>
  );
}
