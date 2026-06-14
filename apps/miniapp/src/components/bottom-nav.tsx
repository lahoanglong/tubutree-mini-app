import type { ReactNode } from 'react';
import { BottomNavigation, Icon, useNavigate, useLocation } from 'zmp-ui';

/** Emoji icon (zmp-ui không có icon giỏ hàng/lá) — bọc cho cỡ đồng nhất. */
function Emo({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 20, lineHeight: 1 }}>{children}</span>;
}

const TABS: { key: string; label: string; icon: ReactNode }[] = [
  { key: '/', label: 'Trang chủ', icon: <Icon icon={'zi-home' as never} /> },
  { key: '/browse', label: 'Danh mục', icon: <Icon icon={'zi-more-grid' as never} /> },
  { key: '/game', label: 'Vườn Xanh', icon: <Emo>🌿</Emo> },
  { key: '/cart', label: 'Giỏ hàng', icon: <Emo>🛒</Emo> },
  { key: '/profile', label: 'Cá nhân', icon: <Icon icon={'zi-user' as never} /> },
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
        <BottomNavigation.Item key={t.key} label={t.label} icon={t.icon} />
      ))}
    </BottomNavigation>
  );
}
