import { Bell } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import logo from '../../assets/tubu-logo.png';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { CartButton } from '../cart-button';
import { CountBadge } from '../ui/cart-badge';
import { IconButton } from '../ui/icon-button';

// Logo gốc 1059x384 → cao 30px thì rộng 83px. Khai báo cả hai để trình duyệt giữ chỗ trước khi ảnh tải.
const LOGO_HEIGHT = 30;
const LOGO_WIDTH = 83;

/** Đầu Trang chủ: logo + chuông (badge số chưa đọc, P1-8) + giỏ (spec 5b.1). Khung trang, không tính là khối. */
export function HomeHeader({ unreadCount }: { unreadCount: number }) {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
      <img src={logo} alt="Tubu Tree" width={LOGO_WIDTH} height={LOGO_HEIGHT} style={{ height: LOGO_HEIGHT, width: LOGO_WIDTH, objectFit: 'contain' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <IconButton
            icon={Bell}
            label={vi.home.notifications}
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
