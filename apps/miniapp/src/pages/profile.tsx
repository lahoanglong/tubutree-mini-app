import { Box, Page, Text, Button, Avatar, Spinner, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import {
  Package, Repeat, Heart, MapPin, Leaf, Wallet, Users, BadgePercent, Pencil,
  Bell, Store, Settings, Info, ChevronRight, Copy, MessagesSquare, ShieldCheck, CalendarClock, type LucideIcon,
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
  '/feed',
  '/admin',
  '/staff',
  '/my-payroll',
]);

const MENU: { group: string; items: MenuItem[] }[] = [
  {
    group: 'Mua sắm',
    items: [
      { Icon: Package, label: 'Đơn hàng của tôi', to: '/orders' },
      { Icon: Repeat, label: 'Đặt định kỳ', to: '/subscriptions' },
      { Icon: Heart, label: 'Sản phẩm yêu thích', to: '/wishlist' },
      { Icon: MapPin, label: 'Sổ địa chỉ', to: '/addresses' },
      { Icon: MessagesSquare, label: 'Cộng đồng hỏi đáp', to: '/feed', hint: 'Hỏi chăm cây · khoe vườn' },
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
  const { user, status, error, logout, restore } = useAuthStore();
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
  const baseMenu = ownedBrandQ.data
    ? MENU.map((s) =>
        s.group === 'Kiếm thưởng'
          ? { ...s, items: [...s.items, { Icon: Store, label: 'Quản lý nhãn hàng', to: '/brand-owner', hint: ownedBrandQ.data!.name }] }
          : s,
      )
    : MENU;
  // Nhóm công việc nội bộ — STAFF thấy "Ca làm", ADMIN thấy thêm "Quản trị nhân sự".
  const isStaffOrAdmin = user?.role === 'STAFF' || user?.role === 'ADMIN';
  const workItems: MenuItem[] = [];
  if (isStaffOrAdmin) {
    workItems.push({ Icon: CalendarClock, label: 'Ca làm & chấm công', to: '/staff', hint: 'Đăng ký ca — chấm công' });
    workItems.push({ Icon: Wallet, label: 'Lương của tôi', to: '/my-payroll', hint: 'Xem lương & thông tin nhận' });
  }
  if (user?.role === 'ADMIN') {
    workItems.push({ Icon: ShieldCheck, label: 'Quản trị nhân sự', to: '/admin', hint: 'Cấp quyền — duyệt ca — lương' });
  }
  const menu = workItems.length > 0 ? [...baseMenu, { group: 'Công việc', items: workItems }] : baseMenu;

  // Đang đăng nhập ngầm → spinner. Nếu login fail (idle/error) → nút thử lại,
  // KHÔNG để spinner quay vô hạn ("tài khoản load mãi").
  if (status !== 'authenticated' || !user) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <Box flex flexDirection="column" justifyContent="center" alignItems="center" style={{ minHeight: '60vh', gap: 14, padding: '0 32px', textAlign: 'center' }}>
          {status === 'loading' ? (
            <Spinner />
          ) : status === 'idle' ? (
            <>
              <Text style={{ fontSize: 48 }}>🌿</Text>
              <Text bold size="large" style={{ color: 'var(--neutral-800)' }}>Đã đăng xuất</Text>
              <Text size="small" style={{ color: 'var(--neutral-500)' }}>
                Đăng nhập để xem tích điểm, đơn hàng và ưu đãi cá nhân của bạn.
              </Text>
              <Button onClick={() => void useAuthStore.getState().login()} style={{ background: 'var(--leaf-600)', minWidth: 180, marginTop: 8 }}>
                Đăng nhập ngay
              </Button>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 48 }}>🌿</Text>
              <Text style={{ color: 'var(--neutral-600)' }}>{error ?? 'Chưa kết nối được, vui lòng thử lại.'}</Text>
              <Button onClick={() => void restore()} style={{ background: 'var(--leaf-600)', minWidth: 180 }}>
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
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 100 }}>

      {/* Header card */}
      <Box
        p={4}
        style={{
          background: 'linear-gradient(135deg, var(--leaf-600), var(--leaf-700))',
          color: 'var(--neutral-0)',
        }}
      >
        <Box
          flex
          alignItems="center"
          className="tubu-press"
          onClick={() => {
            haptic('light');
            navigate('/edit-profile');
          }}
          style={{ gap: 12, cursor: 'pointer' }}
        >
          <Avatar size={56} src={user.avatarUrl ?? undefined} />
          <Box style={{ flex: 1 }}>
            <Text bold size="large" style={{ color: 'var(--neutral-0)', lineHeight: '1.2' }}>
              {user.fullName ?? 'Khách Tubu'}
            </Text>
            <Box flex alignItems="center" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <Box
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'rgba(255,255,255,0.2)',
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                }}
              >
                <Leaf size={12} color="var(--neutral-0)" strokeWidth={2} />
                <Text size="xSmall" style={{ color: 'var(--neutral-0)' }}>
                  {tierName}
                </Text>
              </Box>

              <Box
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'rgba(255,255,255,0.3)',
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }}
              >
                <Pencil size={11} color="var(--neutral-0)" strokeWidth={2} />
                <Text size="xSmall" bold style={{ color: 'var(--neutral-0)' }}>
                  Sửa hồ sơ ›
                </Text>
              </Box>
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
              <Copy size={13} color="var(--neutral-0)" strokeWidth={2} />
              <Text size="xSmall" style={{ color: 'var(--neutral-0)' }}>
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
        <Stat label="Ví Tubu" value={formatVnd(user.walletBalance)} onClick={() => navigate('/wallet', { state: { from: '/profile' } })} />
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
                  if (READY.has(item.to)) navigate(item.to, item.to === '/wallet' ? { state: { from: '/profile' } } : undefined);
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
                      color: 'var(--neutral-0)',
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
