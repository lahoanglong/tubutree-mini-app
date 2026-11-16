'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ellipsis } from 'lucide-react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { homeCopy } from '@tubutree/app-core/home-copy';
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
import { usePublicConfig } from '@/lib/use-public-config';
import { Icon } from '@/components/mini';
import { EarnSheet } from './earn-sheet';
import { PILLAR_ICONS, SHORTCUT_ICONS, SHORTCUT_ROUTES } from './shortcut-visuals';
import { ShortcutsSheet } from './shortcuts-sheet';

/**
 * Hệ sinh thái 6 lối vào ở Trang chủ web (W177): hàng 1 hai thẻ chính (Mua lẻ · Giờ vàng, Đổi rác), hàng 2 bốn ô phụ
 * (Mua chung, Mua xoay vòng, Vườn Xanh, Kho quà 0đ), cùng cấu trúc ở điện thoại lẫn máy tính, dựng tĩnh ngay từ khung hình đầu nên CLS = 0.
 * - Phía dưới là hàng lối tắt nhanh (Mã giảm giá · Cộng đồng) cùng nút "Thêm" mở hộp thoại mọi lối tắt (có cả Giờ vàng).
 */
export function ShortcutGrid({ initialConfig }: { initialConfig?: PublicConfig } = {}) {
  const router = useRouter();
  const cfg = usePublicConfig(initialConfig);
  const [earnOpen, setEarnOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const authed = useAuthPhase() === 'authenticated';
  const wastePaused = cfg.isLoaded && !cfg.waste.enabled;
  const recycleOpenRequests = useRecycleOpenRequests(authed, wastePaused);

  const { heroes, chips } = splitHomeEcosystemPillars(
    resolveHomeEcosystemPillars({
      wastePausedWithOpenRequests: wastePaused && recycleOpenRequests,
    }),
  );

  const all = visibleHomeShortcuts({
    recycleOpenRequests,
    wasteEnabled: !cfg.isLoaded || cfg.waste.enabled,
    claimEnabled: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true,
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
          {heroes.map((p) => (
            <Link
              key={p.id}
              href={p.webHref}
              data-pillar={p.id}
              data-tier="hero"
              className="tubu-bento-card tubu-bento-card--hero tubu-press"
            >
              <div className="tubu-bento-head">
                <span aria-hidden="true" className={`tubu-bento-icon${p.tone === 'warm' ? ' tubu-bento-icon--warm' : ''}`}>
                  <Icon icon={PILLAR_ICONS[p.id]} size="sm" tone="current" />
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
          ))}
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
