import { useNavigate, useLocation } from 'zmp-ui';
import { fillBootCopy } from '@tubutree/app-core/shop-copy-boot';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { useActiveOrderCount } from '../hooks/use-active-order-count';
import { useOffersDot } from '../hooks/use-offers-dot';
import { useEngagementDots } from '../hooks/use-engagement-dots';
import { NAV_TABS, showsBottomNav, type NavTab } from './nav-config';
import { Icon } from './ui/icon';
import { Text } from './ui/text';
import { CountBadge } from './ui/cart-badge';

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
 * Tab bar 5 tab (phương án A): Trang chủ · Danh mục · Quét mã (nút tròn nổi giữa) · Ưu đãi
 * (chấm đỏ khi chưa điểm danh hoặc có mã sắp hết hạn) · Cá nhân (badge đơn đang xử lý). Dữ liệu tab lấy từ nav-config.ts. Ẩn ở trang con.
 */
export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const visible = showsBottomNav(pathname);
  const activeOrders = useActiveOrderCount(visible);
  const reminders = useEngagementDots(visible, activeOrders);
  // Lý do "chưa điểm danh" chỉ nhường cho chấm thẻ Vườn Xanh ở Trang chủ (W42); tab gốc khác không có chấm đó nên Ưu đãi giữ lý do này.
  const offersDot = useOffersDot(visible, reminders.checkInElsewhere && pathname === '/');
  const profileDot = reminders.profile;
  if (!visible) return null;

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
      data-bottom-nav
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
      {NAV_TABS.map((t) => {
        const active = pathname === t.path;
        const count = t.badge === 'active-orders' ? activeOrders : 0;
        const dot = t.badge === 'offers-dot' && offersDot !== null;
        // Mỗi tab tối đa một dấu: số đơn đang xử lý thắng chấm nhắc, để hai dấu đỏ không chồng lên một biểu tượng 24px.
        const remind = t.badge === 'active-orders' && profileDot && count === 0;
        const label =
          count > 0
            ? vi.nav.tabWithActiveOrders(t.label, count)
            : dot
              ? vi.nav.tabWithOffersDot(t.label)
              : remind
                ? fillBootCopy('nav.profileDot', { name: t.label })
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
                </span>
              </>
            ) : (
              <span aria-hidden className={active ? 'tubu-tab-pop' : undefined} style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
                <Icon icon={t.Icon} size="lg" tone={active ? 'brand' : 'muted'} filled={active} />
                <CountBadge count={count} label={vi.nav.activeOrders(count)} />
                {remind && <RemindDot testId="profile-dot" />}
                {dot && <RemindDot testId="offers-dot" />}
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

/** Chấm nhắc 8px (tab Cá nhân: thông báo chưa đọc; tab Ưu đãi: việc cần làm): đứng yên, không nhấp nháy; nghĩa nằm ở aria-label của tab. */
function RemindDot({ testId }: { testId: string }) {
  return <span data-testid={testId} aria-hidden className="tubu-remind-dot" />;
}
