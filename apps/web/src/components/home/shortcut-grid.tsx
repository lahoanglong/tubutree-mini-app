'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ellipsis } from 'lucide-react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import {
  HOME_QUICK_SHORTCUT_IDS,
  resolveHomeEcosystemPillars,
  splitHomeEcosystemPillars,
  visibleHomeShortcuts,
  type HomeShortcutSpec,
} from '@tubutree/app-core/home-layout';
import { isWebRouteReady } from '@/lib/route-map';
import { useAuthPhase } from '@/lib/auth-phase';
import { useRecycleOpenRequests } from '@/lib/use-recycle-open-requests';
import { useEngagementDots } from '@/lib/use-engagement-dots';
import { usePublicConfig } from '@/lib/use-public-config';
import { Icon } from '@/components/mini';
import { EarnSheet } from './earn-sheet';
import { PILLAR_ICONS, SHORTCUT_ICONS, SHORTCUT_ROUTES } from './shortcut-visuals';
import { ShortcutsSheet } from './shortcuts-sheet';

/**
 * Hệ sinh thái 6 lối vào ở Trang chủ web (W177, W42): hàng 1 hai thẻ chính (Mua lẻ · Giờ vàng, Vườn Xanh; không có suất Giờ vàng thì còn một thẻ Vườn Xanh trải hết hàng), hàng 2 bốn ô phụ
 * (Đổi rác, Mua chung, Mua xoay vòng, Kho quà 0đ), cùng cấu trúc ở điện thoại lẫn máy tính, dựng tĩnh ngay từ khung hình đầu nên CLS = 0.
 * - Thẻ Vườn Xanh mang chấm "có việc hôm nay" như Mini App (chỉ vẽ sau khi tải nhiệm vụ của khách đã đăng nhập, HTML máy chủ không đổi).
 * - Phía dưới là hàng lối tắt nhanh (Mã giảm giá · Cộng đồng) cùng nút "Thêm" mở hộp thoại mọi lối tắt (có cả Giờ vàng).
 */
export function ShortcutGrid({ initialConfig, flashLive }: { initialConfig?: PublicConfig; /** `false` = đã biết không có suất Giờ vàng nào có món: bỏ thẻ "Mua lẻ" và lối tắt Giờ vàng. `undefined` = chưa biết (giữ). */ flashLive?: boolean } = {}) {
  const router = useRouter();
  const cfg = usePublicConfig(initialConfig);
  const [earnOpen, setEarnOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const authed = useAuthPhase() === 'authenticated';
  const wastePaused = cfg.isLoaded && !cfg.waste.enabled;
  const recycleOpenRequests = useRecycleOpenRequests(authed, wastePaused);
  // Cùng khoá truy vấn với thanh đáy nên không thêm lệnh gọi.
  const gardenDot = useEngagementDots(true, 0).garden;

  const { heroes, chips } = splitHomeEcosystemPillars(
    resolveHomeEcosystemPillars({
      wastePausedWithOpenRequests: wastePaused && recycleOpenRequests,
      // Chưa có cấu hình thật thì không hứa con số tiết kiệm của đơn định kỳ.
      subscribeDiscountPct: cfg.isLoaded ? cfg.subscribeDiscountPct : null,
      flashLive,
    }),
  );

  const all = visibleHomeShortcuts({
    recycleOpenRequests,
    wasteEnabled: !cfg.isLoaded || cfg.waste.enabled,
    flashLive,
  }).filter((s) => {
    const to = SHORTCUT_ROUTES[s.id];
    return to === null || isWebRouteReady(to.split('?')[0]!);
  });

  const quickItems = HOME_QUICK_SHORTCUT_IDS.flatMap((id) => {
    const spec = all.find((s) => s.id === id);
    const href = SHORTCUT_ROUTES[id];
    return spec && href ? [{ spec, href }] : [];
  });

  const open = (s: HomeShortcutSpec) => {
    const to = SHORTCUT_ROUTES[s.id];
    if (to) router.push(to);
    else setEarnOpen(true);
  };

  return (
    <section aria-label={homeCopy.shortcuts.title} data-testid="shortcut-grid">
      <div data-testid="ecosystem-bento-hub" className="tubu-bento-hub">
        <div className="tubu-bento-grid">
          {heroes.map((p) => {
            const dot = p.id === 'garden' && gardenDot;
            return (
            <Link
              key={p.id}
              href={p.webHref}
              data-pillar={p.id}
              data-tier="hero"
              aria-label={dot ? `${fillCopy('home.pillar.garden.dot', { name: p.title })}. ${p.subtitle}` : undefined}
              className="tubu-bento-card tubu-bento-card--hero tubu-press"
              // Còn MỘT thẻ chính thì nó trải hết hàng; chiều cao do CSS của thẻ giữ nên hàng không đổi cao.
              style={heroes.length === 1 ? { gridColumn: '1 / -1' } : undefined}
            >
              <div className="tubu-bento-head">
                <span aria-hidden="true" className={`tubu-bento-icon${p.tone === 'warm' ? ' tubu-bento-icon--warm' : ''}`}>
                  <Icon icon={PILLAR_ICONS[p.id]} size="sm" tone="current" />
                  {dot && <span data-testid="garden-card-dot" className="tubu-remind-dot tubu-remind-dot--card" />}
                </span>
                <span data-pillar-tag="" className={`tubu-bento-tag${p.tone === 'warm' ? ' tubu-bento-tag--warm' : ''}`}>
                  {p.badge}
                </span>
              </div>
              <div className="tubu-bento-copy">
                <span data-pillar-title="" className="tubu-bento-title">
                  {p.title}
                </span>
                <span data-pillar-sub="" className="tubu-bento-sub">
                  {p.subtitle}
                </span>
              </div>
            </Link>
            );
          })}
        </div>
        <div className="tubu-chip-row">
          {chips.map((p) => (
            <Link
              key={p.id}
              href={p.webHref}
              data-pillar={p.id}
              data-tier="chip"
              aria-label={`${p.title}. ${p.subtitle}`}
              className="tubu-chip tubu-press"
            >
              <span aria-hidden="true" className={`tubu-bento-icon${p.tone === 'warm' ? ' tubu-bento-icon--warm' : ''}`}>
                <Icon icon={PILLAR_ICONS[p.id]} size="sm" tone="current" />
              </span>
              <span data-pillar-title="" className="tubu-chip-label">
                {p.title}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div data-testid="shortcut-quick-pills" className="tubu-quick-pills">
        {quickItems.map(({ spec, href }) => (
          <Link key={spec.id} href={href} aria-label={spec.ariaLabel} className="tubu-quick-pill tubu-press">
            <span aria-hidden="true">
              <Icon icon={SHORTCUT_ICONS[spec.id]} size="sm" tone="current" />
            </span>
            <span data-quick-label="">{spec.label}</span>
          </Link>
        ))}
        <button
          type="button"
          aria-label={homeCopy.shortcuts.moreAria}
          aria-haspopup="dialog"
          className="tubu-quick-pill tubu-quick-pill--more tubu-press"
          onClick={() => setAllOpen(true)}
        >
          <span aria-hidden="true">
            <Icon icon={Ellipsis} size="sm" tone="current" />
          </span>
          <span data-quick-label="">{homeCopy.shortcuts.more}</span>
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
