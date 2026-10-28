import { useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { Gift, HeartHandshake, MessagesSquare, Package, Recycle, ScanLine, Ticket, Users, type LucideIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { SHORTCUT_TINT_VARS, visibleHomeShortcuts, type HomeShortcutId } from '@tubutree/app-core/home-layout';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useRecycleOpenRequests } from '../../hooks/use-recycle-open-requests';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { Icon } from '../ui/icon';
import { ScrollRow } from '../ui/scroll-row';
import { Text } from '../ui/text';
import { EarnSheet } from './earn-sheet';

const VISUALS: Record<HomeShortcutId, { Icon: LucideIcon; to: string | null }> = {
  orders: { Icon: Package, to: '/orders' },
  rewards: { Icon: Gift, to: '/rewards' },
  recycle: { Icon: Recycle, to: '/recycle' },
  groupBuy: { Icon: Users, to: '/group-buy' },
  coupons: { Icon: Ticket, to: '/offers?section=coupons' },
  claim: { Icon: ScanLine, to: '/points/scan' },
  earn: { Icon: HeartHandshake, to: null },
  community: { Icon: MessagesSquare, to: '/feed' },
};

const ITEM_WIDTH = 76;
const CIRCLE = 44;

/**
 * Lối tắt MỘT hàng cuộn ngang ở Trang chủ (Đơn hàng, Đổi quà, Đổi rác, Mua chung, Mã của tôi, Kiếm tiền, Cộng đồng...): biểu tượng
 * tròn màu nhạt, nhãn ngắn. Không có ô trùng thanh đáy (Vườn Xanh). Mục có cờ tắt (Đổi rác, Tích điểm đơn sàn) bị ẩn và hàng tự dồn.
 */
export function ShortcutGrid() {
  const navigate = useNavigate();
  const cfg = usePublicConfig();
  const [earnOpen, setEarnOpen] = useState(false);
  const authed = useAuthStore((st) => st.status === 'authenticated');
  const recycleOpenRequests = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);
  const items = visibleHomeShortcuts({
    recycleOpenRequests,
    wasteEnabled: cfg.isLoaded && cfg.waste.enabled,
    claimEnabled: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true,
  });
  return (
    <section aria-label={homeCopy.shortcuts.title} style={{ padding: '0 0 12px' }}>
      <ScrollRow label={homeCopy.shortcuts.rail} style={{ gap: 4, padding: '4px 12px' }}>
        {items.map((s) => {
          const v = VISUALS[s.id];
          const tint = SHORTCUT_TINT_VARS[s.tint];
          return (
            <button
              key={s.id}
              type="button"
              aria-label={s.ariaLabel}
              className="tubu-press"
              onClick={() => {
                haptic('light');
                if (v.to) navigate(v.to);
                else setEarnOpen(true);
              }}
              style={{
                flex: `0 0 ${ITEM_WIDTH}px`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                minHeight: 44,
                padding: '4px 2px',
                border: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden
                style={{ width: CIRCLE, height: CIRCLE, borderRadius: 'var(--radius-pill)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center' }}
              >
                <Icon icon={v.Icon} size="md" tone="current" />
              </span>
              <Text
                variant="caption"
                style={{ textAlign: 'center', fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}
              >
                {s.label}
              </Text>
            </button>
          );
        })}
      </ScrollRow>
      <EarnSheet open={earnOpen} onClose={() => setEarnOpen(false)} />
    </section>
  );
}
