import { Box, Page, Text, Button, Avatar, Spinner, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import {
  Package, Repeat, Heart, MapPin, Leaf, Wallet, Users, BadgePercent,
  Bell, Store, Settings, Info, ChevronRight, Copy, type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { getLoyalty, getNotifications } from '../services/account-api';
import { getOwnedBrand } from '../services/brand-owner-api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';

interface MenuItem {
  Icon: LucideIcon;
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
  '/about',
  '/wishlist',
  '/settings',
  '/edit-profile',
  '/subscriptions',
  '/brand-owner',
  '/storefront',
]);

const MENU: { group: string; items: MenuItem[] }[] = [
  {
    group: 'Mua sắm',
    items: [
      { Icon: Package, label: 'Đơn hàng của tôi', to: '/orders' },
      { Icon: Repeat, label: 'Đặt định kỳ', to: '/subscriptions' },
      { Icon: Heart, label: 'Sản phẩm yêu thích', to: '/wishlist' },
      { Icon: MapPin, label: 'Sổ địa chỉ', to: '/addresses' },
    ],
  },
  {
    group: 'Tài sản',
    items: [
      { Icon: Leaf, label: 'Hạng thành viên & Điểm Xanh', to: '/loyalty' },
      { Icon: Wallet, label: 'Ví Tubu', to: '/wallet' },
    ],
  },
  {
    group: 'Kiếm thưởng',
    items: [
      { Icon: Users, label: 'Cộng tác viên', to: '/affiliate', hint: 'Chia sẻ — nhận hoa hồng' },
      { Icon: BadgePercent, label: 'Hoàn tiền sàn ngoài', to: '/cashback' },
    ],
  },
  {
    group: 'Khác',
    items: [
      { Icon: Bell, label: 'Thông báo', to: '/notifications' },
      { Icon: Store, label: 'Đăng ký đại lý', to: '/dealer' },
      { Icon: Settings, label: 'Cài đặt', to: '/settings' },
      { Icon: Info, label: 'Về Tubu Tree & Hỗ trợ', to: '/about' },
    ],
  },
];

export default function ProfilePage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const { user, status, logout, login } = useAuthStore();
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

  // Brand-owner (lộ trình B): chỉ hiện mục "Quản lý nhãn" khi user sở hữu 1 nhãn.
  // Dùng CHUNG queryKey ['owned-brand'] với brand-owner.tsx → 1 lần fetch phục vụ cả 2 màn,
  // và khi chủ nhãn sửa thông tin (invalidate ['owned-brand']) menu hint cũng cập nhật theo.
  const ownedBrandQ = useQuery({
    queryKey: ['owned-brand'],
    queryFn: getOwnedBrand,
    enabled: status === 'authenticated',
    retry: false,
  });
  const menu = ownedBrandQ.data
    ? MENU.map((s) =>
        s.group === 'Kiếm thưởng'
          ? { ...s, items: [...s.items, { Icon: Store, label: 'Quản lý nhãn hàng', to: '/brand-owner', hint: ownedBrandQ.data!.name }] }
          : s,
      )
    : MENU;

  // Đang đăng nhập ngầm → spinner. Nếu login fail (idle/error) → nút thử lại,
  // KHÔNG để spinner quay vô hạn ("tài khoản load mãi").
  if (status !== 'authenticated' || !user) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box flex flexDirection="column" justifyContent="center" alignItems="center" style={{ minHeight: '60vh', gap: 14, padding: '0 32px', textAlign: 'center' }}>
          {status === 'loading' ? (
            <Spinner />
          ) : (
            <>
              <Text style={{ fontSize: 48 }}>🌿</Text>
              <Text style={{ color: 'var(--neutral-600)' }}>Chưa kết nối được tài khoản Zalo.</Text>
              <Button onClick={() => void login()} style={{ background: 'var(--leaf-600)', minWidth: 180 }}>
                Thử lại
              </Button>
            </>
          )}
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
            <Box flex alignItems="center" justifyContent="space-between">
              <Text bold style={{ color: '#fff' }}>
                {user.fullName ?? 'Khách Tubu'}
              </Text>
              <Text
                size="xSmall"
                onClick={() => navigate('/edit-profile')}
                style={{ color: 'rgba(255,255,255,0.9)' }}
              >
                Sửa ›
              </Text>
            </Box>
            <Box
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 4,
                background: 'rgba(255,255,255,0.2)',
                padding: '3px 10px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              <Leaf size={13} color="#fff" strokeWidth={2} />
              <Text size="xSmall" style={{ color: '#fff' }}>
                {tierName}
              </Text>
            </Box>
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
            <Box flex alignItems="center" style={{ gap: 4 }}>
              <Copy size={13} color="#fff" strokeWidth={2} />
              <Text size="xSmall" style={{ color: '#fff' }}>
                Sao chép
              </Text>
            </Box>
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
      {menu.map((section) => (
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
                <Box style={{ width: 34, height: 34, borderRadius: 'var(--radius-md)', background: 'var(--leaf-50)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  <item.Icon size={18} color="var(--leaf-700)" strokeWidth={1.9} />
                </Box>
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
                <ChevronRight size={18} color="var(--neutral-400)" strokeWidth={2} />
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
