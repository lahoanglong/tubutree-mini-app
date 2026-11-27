import { useEffect, useState } from 'react';
import { Bell, Search } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import { HOME_HEADER_HEIGHT } from '@tubutree/app-core/home-layout';
import logo from '../../assets/tubu-logo-mark.png';
import { vi } from '../../i18n/vi';
import { CAPSULE_INSET_END } from '../../utils/capsule';
import { haptic } from '../../utils/haptic';
import { CartButton } from '../cart-button';
import { CountBadge } from '../ui/cart-badge';
import { Icon } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { SR_ONLY } from '../ui/sr-only';
import { Text } from '../ui/text';

// Chỉ hiện dấu logo (khối vuông có lá), không kèm chữ "Tubu Tree": chữ sẽ chiếm chỗ của ô tìm ở 375px. Ảnh là 60 cột đầu (3x) của logo ngang
// 249x90 (bản gốc 1059x384 ở assets/tubu-logo.png): dấu hết ở cột 58, chữ bắt đầu ở cột 63, nên 60 cột cắt đúng khe trống.
// Hiện 20x30; khai báo cả hai để trình duyệt giữ chỗ trước khi ảnh tải.
const LOGO_HEIGHT = 30;
const LOGO_MARK_WIDTH = 20;
// Ô tìm phải chứa trọn "Tìm sản phẩm" (13px, ~87px) trên một dòng. Ở 375px, chừa vùng viên thuốc 96px, ô còn ~135px (chuông và giỏ đứng sát nhau
// khe 4px) nên vừa có cả dấu logo. Từ 360px trở xuống ô chỉ còn ~120px: dấu logo nhường chỗ (h1 vẫn đọc được "Tubu Tree"), ô tìm thành ~148px.
const COMPACT_HEADER_MAX_WIDTH = 360;
const COMPACT_HEADER_QUERY = `(max-width: ${COMPACT_HEADER_MAX_WIDTH}px)`;

function useCompactHeader(): boolean {
  const [compact, setCompact] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_HEADER_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COMPACT_HEADER_QUERY);
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return compact;
}

/**
 * Đầu Trang chủ: MỘT hàng dính cao `HOME_HEADER_HEIGHT` (56px) gồm dấu logo, ô tìm, chuông (badge số chưa đọc, P1-8) và giỏ. Thay hàng logo
 * 68px cuộn mất và ô tìm 54px: cuộn xuống lưới Gợi ý vẫn còn lối vào tìm kiếm và giỏ (CS-06). Tính dính do vỏ khối `search` ở `pages/home.tsx` lo.
 * Ô tìm chỉ là vỏ: mở thẳng bàn phím ở ô thật bên /browse (?focus=search).
 * Lề phải chừa vùng viên thuốc (⋯ ✕) của Zalo: nội dung tràn lên dưới nó (actionBarHidden), nên chuông và giỏ nằm bên trái viên thuốc chứ không dưới nó.
 */
export function HomeHeader({ unreadCount }: { unreadCount: number }) {
  const navigate = useNavigate();
  const compact = useCompactHeader();
  return (
    <div
      data-testid="home-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-inline-sm)',
        paddingLeft: 'var(--space-gutter)',
        paddingRight: CAPSULE_INSET_END,
        height: HOME_HEADER_HEIGHT,
        boxSizing: 'border-box',
      }}
    >
      {/* h1 của trang: logo là tên trang (tên truy cập lấy từ alt) để trình đọc màn hình có điểm mốc tiêu đề. Khổ hẹp thì ẩn hình, giữ h1. */}
      <h1 style={compact ? SR_ONLY : { margin: 0, fontSize: 0, lineHeight: 0, flex: '0 0 auto' }}>
        <img src={logo} alt="Tubu Tree" width={LOGO_MARK_WIDTH} height={LOGO_HEIGHT} style={{ height: LOGO_HEIGHT, width: LOGO_MARK_WIDTH, display: 'block' }} />
      </h1>
      <button
        type="button"
        aria-label={vi.home.searchPlaceholder}
        data-testid="home-search"
        className="tubu-press"
        onClick={() => {
          haptic('light');
          navigate('/browse?focus=search');
        }}
        style={{
          flex: '1 1 0',
          minWidth: 0,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-inline-sm)',
          padding: '0 var(--space-inline-sm) 0 var(--space-inline-md)',
          borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-surface)',
          boxSizing: 'border-box',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <Icon icon={Search} size="sm" tone="muted" />
        <Text variant="caption" tone="tertiary" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vi.home.searchPlaceholder}
        </Text>
      </button>
      {/* Chuông và giỏ là một cụm (khe 4px) để ô tìm có thêm chỗ cho chữ gợi ý một dòng. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--space-inline-sm) / 2)', flex: '0 0 auto' }}>
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          <IconButton
            icon={Bell}
            label={unreadCount > 0 ? vi.home.notificationsUnread(unreadCount) : vi.home.notifications}
            onPress={() => {
              haptic('light');
              navigate('/notifications');
            }}
            style={{ background: 'var(--color-action-secondary-bg)' }}
          />
          <CountBadge count={unreadCount} label={vi.home.unreadBadge(unreadCount)} />
        </div>
        <CartButton />
      </div>
    </div>
  );
}
