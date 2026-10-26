'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, HeartHandshake, MessagesSquare, Recycle, ScanLine, Sprout, Ticket, Users, type LucideIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { SHORTCUT_TINT_VARS, visibleHomeShortcuts, type HomeShortcutId } from '@tubutree/app-core/home-layout';
import { isWebRouteReady } from '@/lib/route-map';
import { useAuthPhase } from '@/lib/auth-phase';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';
import { usePublicConfig } from '@/lib/use-public-config';
import { Icon, Text } from '@/components/mini';
import { EarnSheet } from './earn-sheet';

/** `to: null` = mở bảng "Kiếm tiền cùng Tubu". Đích là route web trong route-map; route chưa làm xong (pending) thì lối tắt ẩn. */
const VISUALS: Record<HomeShortcutId, { Icon: LucideIcon; to: string | null }> = {
  rewards: { Icon: Gift, to: '/kho-qua' },
  garden: { Icon: Sprout, to: '/vuon-xanh' },
  recycle: { Icon: Recycle, to: '/doi-rac' },
  groupBuy: { Icon: Users, to: '/mua-chung' },
  coupons: { Icon: Ticket, to: '/uu-dai?section=coupons' },
  claim: { Icon: ScanLine, to: '/points/scan' },
  earn: { Icon: HeartHandshake, to: null },
  community: { Icon: MessagesSquare, to: '/cong-dong' },
};

/**
 * 8 lối tắt hai hàng ở Trang chủ, bản web của `shortcut-grid.tsx` ở Mini App. Mục có cờ tắt (Đổi rác, Tích điểm đơn sàn) bị ẩn và
 * hàng tự dồn. "Tích điểm đơn sàn" chưa có trang web (route-map: bỏ qua) nên không bao giờ hiện trên web.
 */
export function ShortcutGrid() {
  const router = useRouter();
  const cfg = usePublicConfig();
  const [earnOpen, setEarnOpen] = useState(false);
  const authed = useAuthPhase() === 'authenticated';
  const recycleOpenRequests = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);
  const items = visibleHomeShortcuts({
    recycleOpenRequests,
    wasteEnabled: cfg.isLoaded && cfg.waste.enabled,
    claimEnabled: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true,
  }).filter((s) => {
    const to = VISUALS[s.id].to;
    return to === null || isWebRouteReady(to.split('?')[0]!);
  });
  return (
    <section aria-label={homeCopy.shortcuts.title} className="pb-3 md:max-w-xl" style={{ margin: '0 -8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', rowGap: 8, padding: '4px 0' }}>
        {items.map((s) => {
          const v = VISUALS[s.id];
          const tint = SHORTCUT_TINT_VARS[s.tint];
          return (
            <button
              key={s.id}
              type="button"
              aria-label={s.ariaLabel}
              className="tubu-press"
              onClick={() => (v.to ? router.push(v.to) : setEarnOpen(true))}
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
              <span aria-hidden style={{ width: 48, height: 48, borderRadius: 'var(--radius-pill)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center' }}>
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
