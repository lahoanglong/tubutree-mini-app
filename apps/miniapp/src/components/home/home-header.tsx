import { useEffect, useState } from 'react';
import { Bell, Search } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import { HOME_HEADER_HEIGHT } from '@tubutree/app-core/home-layout';
import logo from '../../assets/tubu-logo-home.png';
import { vi } from '../../i18n/vi';
import { CAPSULE_INSET_END } from '../../utils/capsule';
import { haptic } from '../../utils/haptic';
import { CartButton } from '../cart-button';
import { CountBadge } from '../ui/cart-badge';
import { Icon } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { Text } from '../ui/text';

// Hiện 83x30; ảnh 249x90 (3x) đủ nét cho màn 3x mà nhẹ (bản gốc 1059x384 ở assets/tubu-logo.png nặng ~54 KB). Khai báo cả hai để trình duyệt giữ chỗ trước khi ảnh tải.
const LOGO_HEIGHT = 30;
const LOGO_WIDTH = 83;
// Chỉ lấy dấu logo (khối vuông có lá) ở mép trái ảnh: chữ "Tubu Tree" đi kèm sẽ chiếm chỗ của ô tìm ở 375px. Dấu hết ở cột 58/249 của ảnh,
// chữ bắt đầu ở cột 63: 20px (= cột 60) cắt đúng khe trống; rộng hơn sẽ lộ một dải chữ "T"/"S" bên phải.
const LOGO_MARK_WIDTH = 20;
// Chừa vùng viên thuốc 96px thì ô tìm còn ~116px ở 360 (chữ gợi ý chỉ lọt ~60px, thành "Bạn tì…"): từ khổ này trở xuống chỉ giữ biểu tượng kính lúp, tên truy cập vẫn là aria-label.
const COMPACT_SEARCH_MAX_WIDTH = 360;
const COMPACT_SEARCH_QUERY = `(max-width: ${COMPACT_SEARCH_MAX_WIDTH}px)`;

function useCompactSearch(): boolean {
  const [compact, setCompact] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_SEARCH_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COMPACT_SEARCH_QUERY);
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
  const compactSearch = useCompactSearch();
  return (
    <div
      data-testid="home-header"
      style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: CAPSULE_INSET_END, height: HOME_HEADER_HEIGHT, boxSizing: 'border-box' }}
    >
      {/* h1 của trang: logo là tên trang (tên truy cập lấy từ alt) để trình đọc màn hình có điểm mốc tiêu đề. */}
      <h1 style={{ margin: 0, fontSize: 0, lineHeight: 0, flex: '0 0 auto' }}>
        <span style={{ display: 'block', width: LOGO_MARK_WIDTH, height: LOGO_HEIGHT, overflow: 'hidden' }}>
          <img src={logo} alt="Tubu Tree" width={LOGO_WIDTH} height={LOGO_HEIGHT} style={{ height: LOGO_HEIGHT, width: LOGO_WIDTH, maxWidth: 'none', display: 'block' }} />
        </span>
      </h1>
      <button
        type="button"
        aria-label={vi.home.searchPlaceholder}
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
          justifyContent: compactSearch ? 'center' : undefined,
          gap: 8,
          padding: '0 14px',
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
        {!compactSearch && (
          <Text variant="body-sm" tone="tertiary" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {vi.home.searchPlaceholder}
          </Text>
        )}
      </button>
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
  );
}
