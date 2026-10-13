import { Avatar, Page, useNavigate, useSnackbar } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import {
  Heart, MapPin, Leaf, Wallet, Users, Pencil,
  Bell, Store, Settings, Info, ChevronRight, Copy, MessagesSquare, ShieldCheck, CalendarClock, Recycle, Sparkles, BookOpen, BadgePercent, type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { getCoupons, getLoyalty, getNotifications, getWallet } from '../services/account-api';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Skeleton } from '../components/ui/skeleton';
import { SR_ONLY } from '../components/ui/sr-only';
import { Heading, Text } from '../components/ui/text';
import { getOwnedBrand } from '../services/brand-owner-api';
import { getDealerMe } from '../services/dealer-api';
import { formatVnd, formatPoints } from '../utils/format';
import { haptic } from '../utils/haptic';
import { copyText } from '../utils/clipboard';
import { pointsSummary } from '../utils/points-lots';
import { CASHBACK_ENABLED } from '../utils/features';
import { GROUP_BUY_MENU_HINT } from '../utils/group-buy-copy';

interface MenuItem {
  Icon: LucideIcon;
  label: string;
  to: string;
  hint?: string;
}

const PAGE_TITLE = 'Cá nhân';

export const MENU: { group: string; items: MenuItem[] }[] = [
  {
    group: 'Mua sắm',
    items: [
      { Icon: Users, label: 'Mua chung nhóm', to: '/group-buy', hint: GROUP_BUY_MENU_HINT },
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
    // "Hoàn tiền sàn ngoài" chỉ hiện khi bật cờ (kéo khách sang sàn khác, ngược north-star mua lại).
    group: 'Hợp tác',
    items: [
      { Icon: Users, label: 'Cộng tác viên', to: '/affiliate', hint: 'Chia sẻ — nhận hoa hồng' },
      ...(CASHBACK_ENABLED ? [{ Icon: BadgePercent, label: 'Hoàn tiền sàn ngoài', to: '/cashback' }] : []),
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

  // Đang đăng nhập ngầm → khung chờ. Nếu login fail (idle/error) → nút thử lại,
  // KHÔNG để khung chờ quay vô hạn ("tài khoản load mãi").
  if (status !== 'authenticated' || !user) {
    return (
      <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
        <h1 style={SR_ONLY}>{PAGE_TITLE}</h1>
        {status === 'loading' ? (
          <ProfileSkeleton />
        ) : (
          <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {status === 'idle' ? (
              <EmptyState
                art="sprout"
                heading="Đã đăng xuất"
                body="Đăng nhập để xem tích điểm, đơn hàng và ưu đãi cá nhân của bạn."
                ctaLabel="Đăng nhập ngay"
                onCta={() => void useAuthStore.getState().login()}
              />
            ) : (
              <ErrorState message={error ?? 'Chưa kết nối được, vui lòng thử lại.'} onRetry={() => void restore()} />
            )}
          </div>
        )}
      </Page>
    );
  }

  const tierName = loyaltyQ.data?.tier?.name ?? 'Mầm Xanh';
  // Điểm Xanh = tổng hai lô; chưa tải xong overview thì lấy từ hồ sơ đăng nhập (cũng có đủ hai lô).
  const pointsTotal = pointsSummary(loyaltyQ.data ?? user).total;

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
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 100 }}>
      <h1 style={SR_ONLY}>{PAGE_TITLE}</h1>

      {/* Header card */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
          color: 'var(--color-text-inverse)',
          padding: 16,
        }}
      >
        <div
          role="button"
          {...rowKeyboardProps()}
          className="tubu-press"
          onClick={() => {
            haptic('light');
            navigate('/edit-profile');
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}
        >
          <Avatar size={56} src={user.avatarUrl ?? undefined} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Heading variant="title-md" as="div" tone="inverse" style={{ lineHeight: 1.2 }}>
              {user.fullName ?? 'Khách Tubu'}
            </Heading>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <Badge tone="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon icon={Leaf} size="sm" tone="brand" />
                {tierName}
              </Badge>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid var(--color-text-inverse)',
                }}
              >
                <Icon icon={Pencil} size="sm" tone="inverse" />
                <Text variant="label" tone="inverse">
                  Sửa hồ sơ
                </Text>
                <Icon icon={ChevronRight} size="sm" tone="inverse" />
              </span>
            </div>
          </div>
        </div>

        {user.referralCode && (
          <button
            type="button"
            className="tubu-press"
            onClick={copyReferral}
            style={{
              marginTop: 12,
              width: '100%',
              minHeight: 44,
              boxSizing: 'border-box',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              border: 'none',
              borderRadius: 'var(--radius-control)',
              background: 'var(--color-action-secondary-bg)',
              textAlign: 'left',
            }}
          >
            <Text variant="caption" style={{ color: 'var(--color-action-secondary-fg)' }}>
              Mã giới thiệu: <strong>{user.referralCode}</strong>
            </Text>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
              <Icon icon={Copy} size="sm" tone="brand" />
              <Text variant="caption" style={{ color: 'var(--color-action-secondary-fg)' }}>
                Sao chép
              </Text>
            </span>
          </button>
        )}
      </div>

      {/* Quick stats */}
      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: -20 }}>
        <Stat
          label="Điểm Xanh"
          value={formatPoints(pointsTotal)}
          onClick={() => navigate('/loyalty')}
        />
        <Stat
          label="Ví Tubu"
          value={formatVnd(walletQ.data?.walletBalance ?? user.walletBalance)}
          onClick={() => navigate('/wallet', { state: { from: '/profile' } })}
        />
        <Stat
          label="Mã giảm giá"
          value={couponsQ.data ? `${couponsQ.data.length} mã` : '—'}
          onClick={() => navigate('/loyalty')}
          wide
        />
      </div>

      {/* Menu */}
      {menu.map((section) => (
        <div key={section.group} style={{ margin: '0 16px 12px' }}>
          <Text variant="label" tone="tertiary" as="h2" style={{ marginBottom: 6, marginLeft: 4 }}>
            {section.group.toUpperCase()}
          </Text>
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {section.items.map((item, i) => (
              <ListRow
                key={item.to}
                icon={
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 'var(--radius-control)',
                      background: 'var(--color-bg-subtle)',
                      display: 'grid',
                      placeItems: 'center',
                      flex: '0 0 auto',
                    }}
                  >
                    <Icon icon={item.Icon} size="md" tone="brand" />
                  </span>
                }
                title={item.label}
                subtitle={item.hint}
                trailing={
                  item.to === '/notifications' && unreadCount > 0 ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <UnreadCount count={unreadCount} />
                      <Icon icon={ChevronRight} size="sm" tone="muted" />
                    </span>
                  ) : (
                    'chevron'
                  )
                }
                onPress={() => {
                  haptic('light');
                  navigate(item.to, item.to === '/wallet' ? { state: { from: '/profile' } } : undefined);
                }}
                style={{
                  padding: '12px 12px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)',
                }}
              />
            ))}
          </Card>
        </div>
      ))}

      <div style={{ padding: 16 }}>
        <Button fullWidth variant="secondary" onPress={() => void logout()}>
          Đăng xuất
        </Button>
      </div>
    </Page>
  );
}

function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Đang tải" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton height={104} radius="var(--radius-card)" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={64} radius="var(--radius-card)" />
        ))}
      </div>
      <Skeleton height={176} radius="var(--radius-card)" />
    </div>
  );
}

function UnreadCount({ count }: { count: number }) {
  return (
    <span
      style={{
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        boxSizing: 'border-box',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--color-action-primary-bg)',
        color: 'var(--color-action-primary-fg)',
        fontSize: 'var(--type-label-size)',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {count}
    </span>
  );
}

function Stat({ label, value, onClick, wide }: { label: string; value: string; onClick?: () => void; wide?: boolean }) {
  return (
    <div
      role="button"
      {...rowKeyboardProps()}
      className="tubu-press"
      aria-label={`${label}: ${value}`}
      onClick={onClick}
      style={{
        minHeight: 44,
        boxSizing: 'border-box',
        padding: 12,
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        textAlign: 'center',
        boxShadow: 'var(--elevation-1)',
        // Ba ô trên lưới 2 cột: ô lẻ chiếm cả hàng thay vì để trống một nửa.
        gridColumn: wide ? '1 / -1' : undefined,
      }}
    >
      <Heading variant="title-sm" as="div" tone="brand">
        {value}
      </Heading>
      <Text variant="caption" tone="tertiary" as="div">
        {label}
      </Text>
    </div>
  );
}
