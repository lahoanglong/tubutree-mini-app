import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { Ellipsis } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import {
  HOME_QUICK_SHORTCUT_IDS,
  resolveHomeEcosystemPillars,
  splitHomeEcosystemPillars,
  visibleHomeShortcuts,
  type HomeShortcutSpec,
} from '@tubutree/app-core/home-layout';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useRecycleOpenRequests } from '../../hooks/use-recycle-open-requests';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { Icon } from '../ui/icon';
import { PILLAR_ICONS, SHORTCUT_ICONS, SHORTCUT_ROUTES } from './shortcut-visuals';
import '../../css/ecosystem-hub.css';

// Hai sheet chỉ mở khi khách chạm: nạp lười để gói đầu không gánh chúng, và chỉ dựng từ lần mở đầu (giữ dựng sau đó để sheet đóng có hiệu ứng).
const EarnSheet = lazy(() => import('./earn-sheet').then((m) => ({ default: m.EarnSheet })));
const ShortcutsSheet = lazy(() => import('./shortcuts-sheet').then((m) => ({ default: m.ShortcutsSheet })));

/**
 * Hệ sinh thái 6 lối vào ở Trang chủ Mini App (W177): hàng 1 hai thẻ chính (Mua lẻ · Giờ vàng, Đổi rác), hàng 2 bốn ô phụ
 * (Mua chung, Mua xoay vòng, Vườn Xanh, Kho quà 0đ), rồi hàng lối tắt nhanh.
 * - Dựng tĩnh cả sáu ngay từ khung hình đầu (CLS = 0, vùng chạm ≥ 44px).
 * - Hàng dưới giữ nhanh Mã giảm giá · Cộng đồng và nút "Thêm" mở hộp thoại mọi lối tắt (Giờ vàng, Đơn hàng, Tích điểm đơn sàn...).
 */
export function ShortcutGrid() {
  const navigate = useNavigate();
  const cfg = usePublicConfig();
  const [earnOpen, setEarnOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [earnUsed, setEarnUsed] = useState(false);
  const [allUsed, setAllUsed] = useState(false);
  const authed = useAuthStore((st) => st.status === 'authenticated');
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
  });

  const quickItems = HOME_QUICK_SHORTCUT_IDS.flatMap((id) => {
    const spec = all.find((s) => s.id === id);
    const to = SHORTCUT_ROUTES[id];
    return spec && to ? [{ spec, to }] : [];
  });

  const open = (s: HomeShortcutSpec) => {
    const to = SHORTCUT_ROUTES[s.id];
    if (to) navigate(to);
    else {
      setEarnUsed(true);
      setEarnOpen(true);
    }
  };

  return (
    <section aria-label={homeCopy.shortcuts.title} data-testid="shortcut-grid" className="tubu-bento-section">
      <div data-testid="ecosystem-bento-hub" className="tubu-bento-hub">
        <div className="tubu-bento-grid">
          {heroes.map((p) => (
            <button
              key={p.id}
              type="button"
              data-pillar={p.id}
              data-tier="hero"
              className="tubu-bento-card tubu-bento-card--hero tubu-press"
              onClick={() => {
                haptic('light');
                navigate(p.miniRoute);
              }}
            >
              <span className="tubu-bento-head">
                <span aria-hidden="true" className={`tubu-bento-icon${p.tone === 'warm' ? ' tubu-bento-icon--warm' : ''}`}>
                  <Icon icon={PILLAR_ICONS[p.id]} size="sm" tone="current" />
                </span>
                <span data-pillar-tag="" className={`tubu-bento-tag${p.tone === 'warm' ? ' tubu-bento-tag--warm' : ''}`}>
                  {p.badge}
                </span>
              </span>
              <span className="tubu-bento-copy">
                <span data-pillar-title="" className="tubu-bento-title">
                  {p.title}
                </span>
                <span data-pillar-sub="" className="tubu-bento-sub">
                  {p.subtitle}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="tubu-chip-row">
          {chips.map((p) => (
            <button
              key={p.id}
              type="button"
              data-pillar={p.id}
              data-tier="chip"
              aria-label={`${p.title}. ${p.subtitle}`}
              className="tubu-chip tubu-press"
              onClick={() => {
                haptic('light');
                navigate(p.miniRoute);
              }}
            >
              <span aria-hidden="true" className={`tubu-bento-icon${p.tone === 'warm' ? ' tubu-bento-icon--warm' : ''}`}>
                <Icon icon={PILLAR_ICONS[p.id]} size="sm" tone="current" />
              </span>
              <span data-pillar-title="" className="tubu-chip-label">
                {p.title}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div data-testid="shortcut-quick-pills" className="tubu-quick-pills">
        {quickItems.map(({ spec, to }) => (
          <button
            key={spec.id}
            type="button"
            aria-label={spec.ariaLabel}
            className="tubu-quick-pill tubu-press"
            onClick={() => {
              haptic('light');
              navigate(to);
            }}
          >
            <span aria-hidden="true">
              <Icon icon={SHORTCUT_ICONS[spec.id]} size="sm" tone="current" />
            </span>
            <span data-quick-label="">{spec.label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label={homeCopy.shortcuts.moreAria}
          aria-haspopup="dialog"
          className="tubu-quick-pill tubu-quick-pill--more tubu-press"
          onClick={() => {
            haptic('light');
            setAllUsed(true);
            setAllOpen(true);
          }}
        >
          <span aria-hidden="true">
            <Icon icon={Ellipsis} size="sm" tone="current" />
          </span>
          <span data-quick-label="">{homeCopy.shortcuts.more}</span>
        </button>
      </div>

      {allUsed && (
        <Suspense fallback={null}>
          <ShortcutsSheet
            open={allOpen}
            onClose={() => setAllOpen(false)}
            items={all}
            onSelect={(s) => {
              setAllOpen(false);
              open(s);
            }}
          />
        </Suspense>
      )}
      {earnUsed && (
        <Suspense fallback={null}>
          <EarnSheet open={earnOpen} onClose={() => setEarnOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}
