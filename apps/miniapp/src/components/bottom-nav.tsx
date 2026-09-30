import { useNavigate, useLocation } from 'zmp-ui';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { useActiveOrderCount } from '../hooks/use-active-order-count';
import { NAV_TABS, isRootPath, type NavTab } from './nav-config';
import { Icon } from './ui/icon';
import { Text } from './ui/text';
import { CountBadge } from './ui/cart-badge';

/**
 * Tab bar 5 tab (spec 4a.1): Trang chủ · Danh mục · Vườn Xanh (nút tròn nổi giữa) · Đơn hàng
 * (badge đơn đang xử lý) · Cá nhân. Dữ liệu tab lấy từ nav-config.ts. Ẩn ở trang con.
 */
export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isRoot = isRootPath(pathname);
  const activeOrders = useActiveOrderCount(isRoot);
  if (!isRoot) return null;

  const go = (t: NavTab) => {
    if (pathname === t.path) return;
    haptic('light');
    navigate(t.path);
  };

  return (
    <nav
      aria-label={vi.nav.main}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: 'calc(60px + var(--safe-bottom))',
        paddingBottom: 'var(--safe-bottom)',
        background: 'var(--color-bg-surface)',
        borderTop: '1px solid var(--color-border-subtle)',
        boxShadow: 'var(--elevation-3)',
        display: 'flex',
        alignItems: 'stretch',
        zIndex: 100,
      }}
    >
      {NAV_TABS.map((t) => {
        const active = pathname === t.path;
        const count = t.badge === 'active-orders' ? activeOrders : 0;
        return (
          <button
            key={t.path}
            type="button"
            aria-label={count > 0 ? vi.nav.tabWithActiveOrders(t.label, count) : t.label}
            aria-current={active ? 'page' : undefined}
            className="tubu-press"
            onClick={() => go(t)}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 44,
              position: 'relative',
              border: 'none',
              padding: 0,
              paddingBottom: t.center ? 6 : 0,
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: t.center ? 'flex-end' : 'center',
              gap: 3,
            }}
          >
            {t.center ? (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: -22,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 54,
                  height: 54,
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--color-action-primary-bg)',
                  border: '3px solid var(--color-bg-surface)',
                  boxShadow: 'var(--elevation-2)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon icon={t.Icon} size="lg" tone="inverse" />
              </span>
            ) : (
              <span aria-hidden style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
                <Icon icon={t.Icon} size="lg" tone={active ? 'brand' : 'muted'} />
                <CountBadge count={count} label={vi.nav.activeOrders(count)} />
              </span>
            )}
            <Text variant="caption" tone={active ? 'brand' : 'tertiary'} style={{ fontWeight: active ? 700 : 500 }}>
              {t.label}
            </Text>
          </button>
        );
      })}
    </nav>
  );
}
