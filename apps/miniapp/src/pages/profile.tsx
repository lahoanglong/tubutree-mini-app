import { Box, Page, Text, Avatar, Spinner, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import {
  Heart, MapPin, Leaf, Wallet, Users, Pencil,
  Bell, Store, Settings, Info, ChevronRight, Copy, MessagesSquare, ShieldCheck, CalendarClock, Sprout, Recycle, Sparkles, BookOpen, type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { getCoupons, getLoyalty, getNotifications, getWallet } from '../services/account-api';
import { Button } from '../components/ui/button';
import { getOwnedBrand } from '../services/brand-owner-api';
import { getDealerMe } from '../services/dealer-api';
import { formatVnd, formatPoints, formatXu } from '../utils/format';
import { haptic } from '../utils/haptic';
import { copyText } from '../utils/clipboard';

interface MenuItem {
  Icon: LucideIcon;
  label: string;
  to: string;
  hint?: string;
}

export const MENU: { group: string; items: MenuItem[] }[] = [
  {
    group: 'Mua sắm',
    items: [
      { Icon: Users, label: 'Mua chung nhóm', to: '/group-buy', hint: 'Tiết kiệm đến 30%' },
      { Icon: Recycle, label: 'Trạm Refill & Đổi vỏ', to: '/refill', hint: 'Tích giọt nước xanh' },
      { Icon: Sparkles, label: 'Trợ lý AI 24/7', to: '/ai-advisor', hint: 'Tư vấn sản phẩm' },
      { Icon: Heart, label: 'Sản phẩm yêu thích', to: '/wishlist' },
      { Icon: MapPin, label: 'Sổ địa chỉ', to: '/addresses' },
      { Icon: MessagesSquare, label: 'Cộng đồng hỏi đáp', to: '/feed', hint: 'Hỏi cách dùng · chia sẻ trải nghiệm' },
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
    // Q-15: mục CTV/đại lý/nhãn hàng gom riêng để không chen vào hành trình mua của khách;
    // "Hoàn tiền sàn ngoài" bỏ khỏi hub (kéo khách sang sàn khác, ngược north-star mua lại).
    group: 'Hợp tác',
    items: [
      { Icon: Users, label: 'Cộng tác viên', to: '/affiliate', hint: 'Chia sẻ — nhận hoa hồng' },
      { Icon: Store, label: 'Đăng ký đại lý', to: '/dealer' },
    ],
  },
  {
    group: 'Khác',
    items: [
      { Icon: Bell, label: 'Thông báo', to: '/notifications' },
      { Icon: BookOpen, label: 'Câu chuyện thương hiệu', to: '/brand-story' },
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
  // Cùng queryKey với trang Ví/Ưu đãi nên mở hub không tốn thêm request khi đã có cache.
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: status === 'authenticated' });
  const couponsQ = useQuery({ queryKey: ['coupons'], queryFn: getCoupons, enabled: status === 'authenticated' });

  // Brand-owner (lộ trình B): chỉ hiện mục "Quản lý nhãn" khi user sở hữu 1 nhãn.
  // Dùng CHUNG queryKey ['owned-brand'] với brand-owner.tsx → 1 lần fetch phục vụ cả 2 màn,
  // và khi chủ nhãn sửa thông tin (invalidate ['owned-brand']) menu hint cũng cập nhật theo.
  const ownedBrandQ = useQuery({
    queryKey: ['owned-brand'],
    queryFn: getOwnedBrand,
    enabled: status === 'authenticated',
    retry: false,
  });
  // Đại lý đã duyệt mà menu vẫn mời "Đăng ký đại lý" thì đọc như chưa được duyệt. Dùng chung
  // queryKey ['dealer-me'] với trang /dealer nên không tốn thêm request.
  const dealerQ = useQuery({
    queryKey: ['dealer-me'],
    queryFn: getDealerMe,
    enabled: status === 'authenticated',
    retry: false,
  });
  const dealerItem: MenuItem = dealerQ.data?.isDealer || dealerQ.data?.status === 'APPROVED'
    ? { Icon: Store, label: 'Kênh đại lý', to: '/dealer', hint: dealerQ.data?.tier?.name ?? 'Bảng giá sỉ — công nợ' }
    : dealerQ.data?.status === 'PENDING'
      ? { Icon: Store, label: 'Hồ sơ đại lý', to: '/dealer', hint: 'Đang chờ duyệt' }
      : { Icon: Store, label: 'Đăng ký đại lý', to: '/dealer' };
  const withDealer = MENU.map((s) =>
    s.group === 'Hợp tác'
      ? { ...s, items: s.items.map((it) => (it.to === '/dealer' ? dealerItem : it)) }
      : s,
  );
  const baseMenu = ownedBrandQ.data
    ? withDealer.map((s) =>
        s.group === 'Hợp tác'
          ? { ...s, items: [...s.items, { Icon: Store, label: 'Quản lý nhãn hàng', to: '/brand-owner', hint: ownedBrandQ.data!.name }] }
          : s,
      )
    : withDealer;
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
              <Box style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--leaf-50)', border: '1px solid var(--leaf-200)', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-card)' }}>
                <Sprout size={32} color="var(--leaf-700)" strokeWidth={2} />
              </Box>
              <Text bold size="large" style={{ color: 'var(--neutral-800)' }}>Đã đăng xuất</Text>
              <Text size="small" style={{ color: 'var(--neutral-500)' }}>
                Đăng nhập để xem tích điểm, đơn hàng và ưu đãi cá nhân của bạn.
              </Text>
              <Button onPress={() => void useAuthStore.getState().login()} style={{ minWidth: 180, marginTop: 8 }}>
                Đăng nhập ngay
              </Button>
            </>
          ) : (
            <>
              <Box style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--danger-bg)', border: '1px solid rgba(199,62,62,0.2)', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-card)' }}>
                <Leaf size={32} color="var(--danger)" strokeWidth={2} />
              </Box>
              <Text style={{ color: 'var(--neutral-600)' }}>{error ?? 'Chưa kết nối được, vui lòng thử lại.'}</Text>
              <Button onPress={() => void restore()} style={{ minWidth: 180 }}>
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
    if (!user.referralCode) return;
    void copyText(user.referralCode).then((ok) =>
      openSnackbar(
        ok
          ? { text: 'Đã sao chép mã giới thiệu', type: 'success' }
          : { text: `Không sao chép được — mã của bạn: ${user.referralCode}`, type: 'info', duration: 4000 },
      ),
    );
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
                  Sửa hồ sơ
                </Text>
                <ChevronRight size={12} color="var(--neutral-0)" strokeWidth={2} />
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
            <Text size="xSmall" style={{ color: 'var(--neutral-0)', opacity: 0.9 }}>
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
      <Box p={3} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: -20 }}>
        <Stat
          label="Điểm Xanh"
          value={formatPoints(loyaltyQ.data?.pointsBalance ?? user.pointsBalance)}
          onClick={() => navigate('/loyalty')}
        />
        <Stat
          label="Ví Tubu"
          value={formatVnd(walletQ.data?.walletBalance ?? user.walletBalance)}
          onClick={() => navigate('/wallet', { state: { from: '/profile' } })}
        />
        <Stat
          label="TubuXu"
          value={walletQ.data ? formatXu(walletQ.data.coinsBalance) : '—'}
          onClick={() => navigate('/wallet', { state: { from: '/profile' } })}
        />
        <Stat
          label="Mã giảm giá"
          value={couponsQ.data ? `${couponsQ.data.length} mã` : '—'}
          onClick={() => navigate('/loyalty')}
        />
      </Box>

      {/* Menu */}
      {menu.map((section) => (
        <Box key={section.group} mx={4} mb={3}>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginBottom: 6, marginLeft: 4 }}>
            {section.group.toUpperCase()}
          </Text>
          <Box style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
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
                  navigate(item.to, item.to === '/wallet' ? { state: { from: '/profile' } } : undefined);
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
        <Button fullWidth variant="secondary" onPress={() => void logout()}>
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
      role="button"
      aria-label={`${label}: ${value}`}
      p={3}
      onClick={onClick}
      style={{
        minHeight: 44,
        flex: 1,
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'center',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <Text bold style={{ color: 'var(--leaf-700)', fontSize: 16, fontFamily: 'var(--font-display)' }}>
        {value}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {label}
      </Text>
    </Box>
  );
}
