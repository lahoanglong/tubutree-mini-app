import { useNavigate, useLocation } from 'zmp-ui';
import { Home, LayoutGrid, Sprout, Wallet, User, type LucideIcon } from 'lucide-react';

/**
 * Bottom tab bar tuỳ biến theo design M1 (§ TabBar): 5 tab, Vườn Xanh là nút TRÒN
 * NỔI ở giữa. Trang chủ · Danh mục · Vườn Xanh · Ví & HH · Cá nhân.
 * Icon: bộ Lucide line đồng bộ toàn app. Active = xanh lá brand.
 */
const ACTIVE = 'var(--leaf-600)';
const IDLE = 'var(--neutral-400)';

interface Tab {
  key: string;
  label: string;
  center?: boolean;
  Icon: LucideIcon;
}
const TABS: Tab[] = [
  { key: '/', label: 'Trang chủ', Icon: Home },
  { key: '/browse', label: 'Danh mục', Icon: LayoutGrid },
  { key: '/game', label: 'Vườn Xanh', center: true, Icon: Sprout },
  { key: '/wallet', label: 'Ví & HH', Icon: Wallet },
  { key: '/profile', label: 'Cá nhân', Icon: User },
];

const ROOTS = TABS.map((t) => t.key) as string[];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  if (!ROOTS.includes(path)) return null; // ẩn ở trang con

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: 'calc(60px + var(--safe-bottom))',
        paddingBottom: 'var(--safe-bottom)',
        background: 'var(--neutral-0)',
        borderTop: '1px solid var(--neutral-100)',
        boxShadow: '0 -2px 12px rgba(92,52,10,0.06)',
        display: 'flex',
        alignItems: 'stretch',
        zIndex: 100,
      }}
    >
      {TABS.map((t) => {
        const active = path === t.key;
        const color = active ? ACTIVE : IDLE;
        if (t.center) {
          return (
            <div
              key={t.key}
              role="button"
              aria-label={t.label}
              className="tubu-press"
              onClick={() => navigate(t.key)}
              style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: -22,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  background: 'var(--leaf-600)',
                  display: 'grid',
                  placeItems: 'center',
                  boxShadow: '0 4px 12px rgba(80,144,24,0.4)',
                  border: '3px solid var(--neutral-0)',
                }}
              >
                <t.Icon size={26} color="var(--neutral-0)" strokeWidth={2} absoluteStrokeWidth />
              </div>
              <span style={{ fontSize: 10.5, color, fontWeight: active ? 700 : 500 }}>
                {t.label}
              </span>
            </div>
          );
        }
        return (
          <div
            key={t.key}
            role="button"
            aria-label={t.label}
            className="tubu-press"
            onClick={() => navigate(t.key)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}
          >
            <t.Icon size={23} color={color} strokeWidth={active ? 2.2 : 1.8} absoluteStrokeWidth />
            <span style={{ fontSize: 10.5, color, fontWeight: active ? 700 : 500 }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}
