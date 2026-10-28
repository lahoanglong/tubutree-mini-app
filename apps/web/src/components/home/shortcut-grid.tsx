'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, HeartHandshake, MessagesSquare, Package, Recycle, ScanLine, Ticket, Users, type LucideIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { SHORTCUT_TINT_VARS, visibleHomeShortcuts, type HomeShortcutId } from '@tubutree/app-core/home-layout';
import { isWebRouteReady } from '@/lib/route-map';
import { useAuthPhase } from '@/lib/auth-phase';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';
import { usePublicConfig } from '@/lib/use-public-config';
import { Icon, ScrollRow, Text } from '@/components/mini';
import { EarnSheet } from './earn-sheet';

/** `to: null` = mở bảng "Kiếm tiền cùng Tubu". Đích là route web trong route-map; route chưa làm xong (pending) thì lối tắt ẩn. */
const VISUALS: Record<HomeShortcutId, { Icon: LucideIcon; to: string | null }> = {
  orders: { Icon: Package, to: '/tai-khoan/don-hang' },
  rewards: { Icon: Gift, to: '/kho-qua' },
  recycle: { Icon: Recycle, to: '/doi-rac' },
  groupBuy: { Icon: Users, to: '/mua-chung' },
  coupons: { Icon: Ticket, to: '/uu-dai?section=coupons' },
  claim: { Icon: ScanLine, to: '/points/scan' },
  earn: { Icon: HeartHandshake, to: null },
  community: { Icon: MessagesSquare, to: '/cong-dong' },
};

const ITEM_WIDTH = 76;
const CIRCLE = 44;

/**
 * Lối tắt MỘT hàng cuộn ngang ở Trang chủ, bản web của `shortcut-grid.tsx` ở Mini App (Đơn hàng, Đổi quà, Đổi rác, Mua chung, Mã của tôi,
 * Kiếm tiền, Cộng đồng...), không có Vườn Xanh (đã là tab giữa). Từ md các ô dàn đều hết bề ngang thay vì chừa nửa phải trống. Mục có cờ
 * tắt bị ẩn và hàng tự dồn. "Tích điểm đơn sàn" chưa có trang web (route-map: bỏ qua) nên không bao giờ hiện trên web.
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
    <section aria-label={homeCopy.shortcuts.title} className="pb-3">
      <ScrollRow label={homeCopy.shortcuts.rail} className="md:justify-between" style={{ gap: 4, padding: '4px 0', margin: '0 -16px', paddingInline: 12, maxWidth: 'none' }}>
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
              <span aria-hidden style={{ width: CIRCLE, height: CIRCLE, borderRadius: 'var(--radius-pill)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center' }}>
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
