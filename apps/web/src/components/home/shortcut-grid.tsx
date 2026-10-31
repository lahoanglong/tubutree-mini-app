'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_SHORTCUT_SLOTS, SHORTCUT_TINT_VARS, visibleHomeShortcuts, type HomeShortcutSpec } from '@tubutree/app-core/home-layout';
import { isWebRouteReady } from '@/lib/route-map';
import { useAuthPhase } from '@/lib/auth-phase';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';
import { usePublicConfig } from '@/lib/use-public-config';
import { Icon, Text } from '@/components/mini';
import { EarnSheet } from './earn-sheet';
import { SHORTCUT_ICONS, SHORTCUT_ROUTES } from './shortcut-visuals';
import { ShortcutsSheet } from './shortcuts-sheet';

const CELL_HEIGHT = 84;
const CIRCLE = 44;

const cellStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  height: CELL_HEIGHT,
  minHeight: 44,
  minWidth: 0,
  padding: '8px 2px 0',
  boxSizing: 'border-box',
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  cursor: 'pointer',
} as const;

/**
 * Lối tắt Trang chủ (Q7), bản web của `shortcut-grid.tsx` ở Mini App: 4 ô cố định + ô "Tất cả" trong MỘT hàng 5 cột đều nhau, không cuộn ngang. Phần
 * còn lại nằm trong sheet "Tất cả". Mục có cờ tắt bị ẩn, mục kế lấp chỗ. Mục có route web chưa làm xong bị bỏ TRƯỚC khi chia ô cố định (nên ô cố định
 * luôn đủ 4 khi còn mục). "Tích điểm đơn sàn" chưa có trang web nên không bao giờ hiện. Từ lg thanh điều hướng website đã có các lối này nên khối ẩn.
 */
export function ShortcutGrid() {
  const router = useRouter();
  const cfg = usePublicConfig();
  const [earnOpen, setEarnOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const authed = useAuthPhase() === 'authenticated';
  const recycleOpenRequests = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);
  const all = visibleHomeShortcuts({
    recycleOpenRequests,
    wasteEnabled: cfg.isLoaded && cfg.waste.enabled,
    claimEnabled: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true,
  }).filter((s) => {
    const to = SHORTCUT_ROUTES[s.id];
    return to === null || isWebRouteReady(to.split('?')[0]!);
  });
  const pinned = all.slice(0, HOME_SHORTCUT_SLOTS);

  const open = (s: HomeShortcutSpec) => {
    const to = SHORTCUT_ROUTES[s.id];
    if (to) router.push(to);
    else setEarnOpen(true);
  };

  return (
    <section aria-label={homeCopy.shortcuts.title} className="lg:hidden">
      <div data-testid="shortcut-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        {pinned.map((s) => {
          const tint = SHORTCUT_TINT_VARS[s.tint];
          return (
            <button key={s.id} type="button" aria-label={s.ariaLabel} className="tubu-press" onClick={() => open(s)} style={cellStyle}>
              <span aria-hidden style={{ width: CIRCLE, height: CIRCLE, borderRadius: 'var(--radius-pill)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center' }}>
                <Icon icon={SHORTCUT_ICONS[s.id]} size="md" tone="current" />
              </span>
              <Text variant="caption" style={{ maxWidth: '100%', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.label}
              </Text>
            </button>
          );
        })}
        <button type="button" aria-label={homeCopy.shortcuts.allAria} aria-haspopup="dialog" className="tubu-press" onClick={() => setAllOpen(true)} style={cellStyle}>
          <span aria-hidden style={{ width: CIRCLE, height: CIRCLE, borderRadius: 'var(--radius-pill)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)', display: 'grid', placeItems: 'center' }}>
            <Icon icon={LayoutGrid} size="md" tone="current" />
          </span>
          <Text variant="caption" style={{ textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {homeCopy.shortcuts.all}
          </Text>
        </button>
      </div>
      <ShortcutsSheet
        open={allOpen}
        onClose={() => setAllOpen(false)}
        items={all}
        onSelect={(s) => {
          setAllOpen(false);
          open(s);
        }}
      />
      <EarnSheet open={earnOpen} onClose={() => setEarnOpen(false)} />
    </section>
  );
}
