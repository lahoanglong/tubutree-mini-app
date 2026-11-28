'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Ellipsis } from 'lucide-react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { homeShortcutGrid, SHORTCUT_TINT_VARS, type HomeGridCell, type HomeShortcutSpec } from '@tubutree/app-core/home-layout';
import { useRouter } from 'next/navigation';
import { isWebRouteReady } from '@/lib/route-map';
import { useAuthPhase } from '@/lib/auth-phase';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';
import { useEngagementDots } from '@/lib/use-engagement-dots';
import { usePublicConfig } from '@/lib/use-public-config';
import { Icon } from '@/components/mini';
import { EarnSheet } from './earn-sheet';
import { PILLAR_ICONS, SHORTCUT_ICONS, SHORTCUT_ROUTES } from './shortcut-visuals';
import { ShortcutsSheet } from './shortcuts-sheet';

/** Lối tắt phụ chỉ lên lưới khi đích web đã có trang (route chưa xong thì ẩn); Kiếm tiền mở sheet nên luôn dùng được. */
const shortcutReady = (s: HomeShortcutSpec) => {
  const to = SHORTCUT_ROUTES[s.id];
  return to === null || isWebRouteReady(to.split('?')[0]!);
};

/**
 * Lối tắt Trang chủ web (W47, bản web của `shortcut-grid.tsx` ở Mini App): MỘT lưới biểu tượng 4 cột × 2 hàng (`homeShortcutGrid`), cùng cấu trúc ở điện
 * thoại lẫn máy tính, dựng tĩnh ngay từ khung hình đầu nên CLS = 0. Sáu lối vào hệ sinh thái giữ `data-pillar` của W171; ô cuối "Thêm" mở sheet các lối
 * tắt chưa lên lưới. Ô Vườn Xanh mang chấm "có việc hôm nay" như Mini App (chỉ vẽ sau khi tải nhiệm vụ của khách đã đăng nhập, HTML máy chủ không đổi).
 */
export function ShortcutGrid({ initialConfig, flashLive }: { initialConfig?: PublicConfig; /** `false` = đã biết không có suất Giờ vàng nào có món: bỏ ô Giờ vàng. `undefined` = chưa biết (giữ). */ flashLive?: boolean } = {}) {
  const router = useRouter();
  const cfg = usePublicConfig(initialConfig);
  const [earnOpen, setEarnOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const authed = useAuthPhase() === 'authenticated';
  const wastePaused = cfg.isLoaded && !cfg.waste.enabled;
  const recycleOpenRequests = useRecycleOpenRequests(authed, wastePaused);
  // Cùng khoá truy vấn với thanh đáy nên không thêm lệnh gọi.
  const gardenDot = useEngagementDots(true, 0).garden;

  const { cells, more } = homeShortcutGrid({
    wastePausedWithOpenRequests: wastePaused && recycleOpenRequests,
    // Chưa có cấu hình thật thì không hứa con số tiết kiệm của đơn định kỳ.
    subscribeDiscountPct: cfg.isLoaded ? cfg.subscribeDiscountPct : null,
    flashLive,
    gardenDot,
    shortcutReady,
  });

  const openShortcut = (id: HomeShortcutSpec['id']) => {
    const to = SHORTCUT_ROUTES[id];
    if (to) router.push(to);
    else setEarnOpen(true);
  };

  const body = (c: HomeGridCell) => {
    const tint = SHORTCUT_TINT_VARS[c.tint];
    return (
      <>
        <span aria-hidden="true" className="tubu-shortcut-icon" style={{ background: tint.bg, color: tint.fg }}>
          <Icon icon={c.kind === 'pillar' ? PILLAR_ICONS[c.id] : SHORTCUT_ICONS[c.id]} size="md" tone="current" />
          {c.kind === 'pillar' && c.dot && <span data-testid="garden-card-dot" className="tubu-remind-dot tubu-remind-dot--card" />}
        </span>
        <span data-shortcut-label="" className="tubu-shortcut-label">
          {c.label}
        </span>
      </>
    );
  };

  return (
    <section aria-label={homeCopy.shortcuts.title} data-testid="shortcut-grid">
      <div className="tubu-shortcut-grid">
        {cells.map((c) => {
          const href = c.kind === 'pillar' ? c.webHref : SHORTCUT_ROUTES[c.id];
          const common = {
            'data-pillar': c.kind === 'pillar' ? c.id : undefined,
            'data-shortcut': c.kind === 'shortcut' ? c.id : undefined,
            'aria-label': c.ariaLabel,
            className: 'tubu-shortcut-cell tubu-press',
          };
          return href ? (
            <Link key={`${c.kind}:${c.id}`} href={href} {...common}>
              {body(c)}
            </Link>
          ) : (
            <button key={`${c.kind}:${c.id}`} type="button" aria-haspopup="dialog" onClick={() => openShortcut(c.id as HomeShortcutSpec['id'])} {...common}>
              {body(c)}
            </button>
          );
        })}
        {more.length > 0 && (
          <button
            type="button"
            aria-label={homeCopy.shortcuts.moreAria}
            aria-haspopup="dialog"
            className="tubu-shortcut-cell tubu-press"
            onClick={() => setAllOpen(true)}
          >
            <span aria-hidden="true" className="tubu-shortcut-icon tubu-shortcut-icon--more">
              <Icon icon={Ellipsis} size="md" tone="current" />
            </span>
            <span data-shortcut-label="" className="tubu-shortcut-label">
              {homeCopy.shortcuts.more}
            </span>
          </button>
        )}
      </div>

      <ShortcutsSheet
        open={allOpen}
        onClose={() => setAllOpen(false)}
        items={more}
        onSelect={(s) => {
          setAllOpen(false);
          openShortcut(s.id);
        }}
      />
      <EarnSheet open={earnOpen} onClose={() => setEarnOpen(false)} />
    </section>
  );
}
