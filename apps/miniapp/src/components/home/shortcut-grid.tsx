import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { Ellipsis } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { homeShortcutGrid, SHORTCUT_TINT_VARS, type HomeGridCell, type HomeShortcutSpec } from '@tubutree/app-core/home-layout';
import { usePublicConfig } from '../../hooks/use-public-config';
import { isRootPath, useSmartNavigate } from '../../lib/smart-nav';
import { useRecycleOpenRequests } from '../../hooks/use-recycle-open-requests';
import { useEngagementDots } from '../../hooks/use-engagement-dots';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { Icon } from '../ui/icon';
import { PILLAR_ICONS, SHORTCUT_ICONS, SHORTCUT_ROUTES } from './shortcut-visuals';
import '../../css/ecosystem-hub.css';

// Hai sheet chỉ mở khi khách chạm: nạp lười để gói đầu không gánh chúng, và chỉ dựng từ lần mở đầu (giữ dựng sau đó để sheet đóng có hiệu ứng).
const EarnSheet = lazy(() => import('./earn-sheet').then((m) => ({ default: m.EarnSheet })));
const ShortcutsSheet = lazy(() => import('./shortcuts-sheet').then((m) => ({ default: m.ShortcutsSheet })));

export interface ShortcutGridProps {
  /** `false` = đã biết không có suất Giờ vàng nào có món: bỏ ô Giờ vàng, lối tắt kế tiếp lấp chỗ. Chưa biết (`undefined`) thì giữ. */
  flashLive?: boolean;
}

/**
 * Lối tắt Trang chủ Mini App (W47): MỘT lưới biểu tượng 4 cột × 2 hàng (`homeShortcutGrid`), mọi ô cùng cỡ để khách quét một lượt. Sáu lối vào hệ
 * sinh thái giữ `data-pillar` của W171, lối tắt phụ lấp ô còn lại, ô cuối "Thêm" mở sheet các lối tắt chưa lên lưới (không lặp đích đã có trên lưới).
 * - Dựng tĩnh ngay từ khung hình đầu, nhãn giữ chỗ hai dòng: lưới luôn cao như nhau (CLS = 0), vùng chạm ≥ 44px.
 * - Ô Vườn Xanh mang chấm "có việc hôm nay" (chưa điểm danh hoặc chưa làm Đố Xanh).
 */
export function ShortcutGrid({ flashLive }: ShortcutGridProps) {
  const navigate = useNavigate();
  const cfg = usePublicConfig();
  const [earnOpen, setEarnOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [earnUsed, setEarnUsed] = useState(false);
  const [allUsed, setAllUsed] = useState(false);
  const authed = useAuthStore((st) => st.status === 'authenticated');
  const wastePaused = cfg.isLoaded && !cfg.waste.enabled;
  const recycleOpenRequests = useRecycleOpenRequests(authed, wastePaused);
  // Cùng khoá truy vấn với thanh đáy (đang hiện ở Trang chủ) nên không thêm lệnh gọi.
  const gardenDot = useEngagementDots(true, 0).garden;

  const { cells, more } = homeShortcutGrid({
    wastePausedWithOpenRequests: wastePaused && recycleOpenRequests,
    subscribeDiscountPct: cfg.isLoaded ? cfg.subscribeDiscountPct : null,
    flashLive,
    gardenDot,
  });

  const goSmart = useSmartNavigate();
  // Lối tắt tới trang con (Bộ quà tặng, Mã giảm giá...) đi qua smartNavigate: đích chính là trang ngay trước thì lùi thật, không chồng bản sao
  // vào lịch sử. Đích là tab gốc (Ưu đãi) giữ cách mở như cũ của Trang chủ.
  const go = (to: string) => (isRootPath(to.split(/[?#]/)[0]!) ? navigate(to) : goSmart(to));

  const openShortcut = (id: HomeShortcutSpec['id']) => {
    const to = SHORTCUT_ROUTES[id];
    if (to) go(to);
    else {
      setEarnUsed(true);
      setEarnOpen(true);
    }
  };

  const press = (c: HomeGridCell) => {
    haptic('light');
    if (c.kind === 'pillar') navigate(c.miniRoute);
    else openShortcut(c.id);
  };

  return (
    <section aria-label={homeCopy.shortcuts.title} data-testid="shortcut-grid" className="tubu-shortcut-section">
      <div className="tubu-shortcut-grid">
        {cells.map((c) => {
          const dot = c.kind === 'pillar' && c.dot === true;
          const tint = SHORTCUT_TINT_VARS[c.tint];
          return (
            <button
              key={`${c.kind}:${c.id}`}
              type="button"
              data-pillar={c.kind === 'pillar' ? c.id : undefined}
              data-shortcut={c.kind === 'shortcut' ? c.id : undefined}
              aria-label={c.ariaLabel}
              className="tubu-shortcut-cell tubu-press"
              onClick={() => press(c)}
            >
              <span aria-hidden="true" className="tubu-shortcut-icon" style={{ background: tint.bg, color: tint.fg }}>
                <Icon icon={c.kind === 'pillar' ? PILLAR_ICONS[c.id] : SHORTCUT_ICONS[c.id]} size="md" tone="current" />
                {dot && <span data-testid="garden-card-dot" className="tubu-remind-dot tubu-remind-dot--card" />}
              </span>
              <span data-shortcut-label="" className="tubu-shortcut-label">
                {c.label}
              </span>
            </button>
          );
        })}
        {more.length > 0 && (
          <button
            type="button"
            aria-label={homeCopy.shortcuts.moreAria}
            aria-haspopup="dialog"
            className="tubu-shortcut-cell tubu-press"
            onClick={() => {
              haptic('light');
              setAllUsed(true);
              setAllOpen(true);
            }}
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

      {allUsed && (
        <Suspense fallback={null}>
          <ShortcutsSheet
            open={allOpen}
            onClose={() => setAllOpen(false)}
            items={more}
            onSelect={(s) => {
              setAllOpen(false);
              openShortcut(s.id);
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
