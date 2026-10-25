import { useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { Gift, HeartHandshake, MessagesSquare, Recycle, ScanLine, Sprout, Ticket, Users, type LucideIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { SHORTCUT_TINT_VARS, visibleHomeShortcuts, type HomeShortcutId } from '@tubutree/app-core/home-layout';
import { usePublicConfig } from '../../hooks/use-public-config';
import { haptic } from '../../utils/haptic';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { EarnSheet } from './earn-sheet';

const VISUALS: Record<HomeShortcutId, { Icon: LucideIcon; to: string | null }> = {
  rewards: { Icon: Gift, to: '/rewards' },
  garden: { Icon: Sprout, to: '/game' },
  recycle: { Icon: Recycle, to: '/recycle' },
  groupBuy: { Icon: Users, to: '/group-buy' },
  coupons: { Icon: Ticket, to: '/offers?section=coupons' },
  claim: { Icon: ScanLine, to: '/points/scan' },
  earn: { Icon: HeartHandshake, to: null },
  community: { Icon: MessagesSquare, to: '/feed' },
};

/**
 * 8 lối tắt hai hàng ở Trang chủ (như lưới dịch vụ của Shopee/MoMo): biểu tượng tròn màu nhạt, nhãn ngắn.
 * Mục có cờ tắt (Đổi rác, Tích điểm đơn sàn) bị ẩn và hàng tự dồn.
 */
export function ShortcutGrid() {
  const navigate = useNavigate();
  const cfg = usePublicConfig();
  const [earnOpen, setEarnOpen] = useState(false);
  const items = visibleHomeShortcuts({
    wasteEnabled: cfg.isLoaded && cfg.waste.enabled,
    claimEnabled: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true,
  });
  return (
    <section aria-label={homeCopy.shortcuts.title} style={{ padding: '4px 8px 12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', rowGap: 8 }}>
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
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
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
                style={{ width: 48, height: 48, borderRadius: 'var(--radius-pill)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center' }}
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
      </div>
      <EarnSheet open={earnOpen} onClose={() => setEarnOpen(false)} />
    </section>
  );
}
