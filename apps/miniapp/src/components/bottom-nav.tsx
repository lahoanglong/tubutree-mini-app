import { useNavigate, useLocation } from 'zmp-ui';
import { fillBootCopy } from '@tubutree/app-core/shop-copy-boot';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { useActiveOrderCount } from '../hooks/use-active-order-count';
import { useOffersDot } from '../hooks/use-offers-dot';
import { useEngagementDots } from '../hooks/use-engagement-dots';
import { NAV_TABS, isRootPath, type NavTab } from './nav-config';
import { Icon } from './ui/icon';
import { Text } from './ui/text';
import { CountBadge } from './ui/cart-badge';
import { GardenHintBubble } from './garden-hint-bubble';

/**
 * Cuộn trang đang mở về đầu. Vùng cuộn của Mini App là `.zaui-page` (không phải cửa sổ); lúc chuyển cảnh lớp trang cũ còn nằm
 * trước lớp mới trong DOM nên lấy lớp cuối. Khách bật giảm chuyển động thì nhảy thẳng, không cuộn mượt.
 */
function scrollPageToTop() {
  const pages = document.querySelectorAll<HTMLElement>('.zaui-page');
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const options: ScrollToOptions = { top: 0, behavior: reduce ? 'auto' : 'smooth' };
  (pages[pages.length - 1] ?? window).scrollTo(options);
}

/**
 * Tab bar 5 tab (phương án A): Trang chủ · Danh mục · Vườn Xanh (nút tròn nổi giữa) · Ưu đãi
 * (chấm đỏ khi chưa điểm danh hoặc có mã sắp hết hạn) · Cá nhân (badge đơn đang xử lý). Dữ liệu tab lấy từ nav-config.ts. Ẩn ở trang con.
 */
export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isRoot = isRootPath(pathname);
  const activeOrders = useActiveOrderCount(isRoot);
  const reminders = useEngagementDots(isRoot, activeOrders);
  const offersDot = useOffersDot(isRoot, reminders.checkInElsewhere);
  const gardenDot = reminders.garden;
  const profileDot = reminders.profile;
  if (!isRoot) return null;

  const go = (t: NavTab) => {
    haptic('light');
    if (pathname === t.path) {
      scrollPageToTop();
      return;
    }
    // Tab gốc ↔ tab gốc thay mục hiện tại (không chồng lịch sử ngang): Back từ tab nào cũng không bị trượt qua hàng loạt tab đã mở.
    navigate(t.path, { replace: true });
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
        boxShadow: 'var(--elevation-nav)',
        display: 'flex',
        alignItems: 'stretch',
        zIndex: 100,
      }}
    >
      <GardenHintBubble onGardenTab={pathname === '/game'} onOpenGarden={() => navigate('/game', { replace: true })} />
      {NAV_TABS.map((t) => {
        const active = pathname === t.path;
        const count = t.badge === 'active-orders' ? activeOrders : 0;
        const dot = t.badge === 'offers-dot' && offersDot !== null;
        const remind = (t.center === true && gardenDot) || (t.badge === 'active-orders' && profileDot);
        const label =
          count > 0
            ? vi.nav.tabWithActiveOrders(t.label, count)
            : dot
              ? vi.nav.tabWithOffersDot(t.label)
              : remind
                ? fillBootCopy(t.center ? 'nav.gardenDot' : 'nav.profileDot', { name: t.label })
                : t.label;
        return (
          <button
            key={t.path}
            type="button"
            aria-label={label}
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
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
            }}
          >
            {t.center ? (
              <>
                <span aria-hidden style={{ height: 24, flexShrink: 0 }} />
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
                  {remind && <RemindDot testId="garden-dot" center />}
                </span>
              </>
            ) : (
              <span aria-hidden className={active ? 'tubu-tab-pop' : undefined} style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
                <Icon icon={t.Icon} size="lg" tone={active ? 'brand' : 'muted'} filled={active} />
                <CountBadge count={count} label={vi.nav.activeOrders(count)} />
                {remind && <RemindDot testId="profile-dot" />}
                {dot && (
                  <span
                    data-testid="offers-dot"
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: -1,
                      right: -3,
                      width: 10,
                      height: 10,
                      borderRadius: 'var(--radius-pill)',
                      background: 'var(--color-action-danger-bg)',
                      border: '2px solid var(--color-bg-surface)',
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </span>
            )}
            <Text variant="label" tone={active ? 'brand' : 'tertiary'} style={{ fontWeight: active ? 600 : 500 }}>
              {t.label}
            </Text>
          </button>
        );
      })}
    </nav>
  );
}

/** Chấm nhắc 8px của nhiệm vụ hằng ngày (Vườn Xanh, Cá nhân): đứng yên, không nhấp nháy; nghĩa nằm ở aria-label của tab. */
function RemindDot({ testId, center = false }: { testId: string; center?: boolean }) {
  return <span data-testid={testId} aria-hidden className={center ? 'tubu-remind-dot tubu-remind-dot--center' : 'tubu-remind-dot'} />;
}
