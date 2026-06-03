import { BottomNavigation, Icon, useNavigate, useLocation } from 'zmp-ui';

const TABS = [
  { key: '/', label: 'Trang chủ', icon: 'zi-home' },
  { key: '/browse', label: 'Khám phá', icon: 'zi-search' },
  { key: '/game', label: 'Vườn Xanh', icon: 'zi-star' },
  { key: '/cart', label: 'Giỏ hàng', icon: 'zi-add-photo' },
  { key: '/profile', label: 'Tài khoản', icon: 'zi-user' },
];

/** Bottom tab bar — chỉ hiện ở các trang gốc. */
export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = TABS.find((t) => t.key === location.pathname)?.key;

  if (!active) return null; // ẩn ở trang con (PDP, checkout, order detail...)

  return (
    <BottomNavigation
      fixed
      activeKey={active}
      onChange={(key) => navigate(key)}
      style={{ '--zmp-primary-color': 'var(--green-600)' } as React.CSSProperties}
    >
      {TABS.map((t) => (
        <BottomNavigation.Item
          key={t.key}
          label={t.label}
          icon={<Icon icon={t.icon as never} />}
        />
      ))}
    </BottomNavigation>
  );
}
