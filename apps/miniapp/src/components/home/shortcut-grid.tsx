import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { LayoutGrid } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { SHORTCUT_TINT_VARS, homeShortcutSlots, type HomeShortcutSpec } from '@tubutree/app-core/home-layout';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useRecycleOpenRequests } from '../../hooks/use-recycle-open-requests';
import { useAuthStore } from '../../store/auth';
import { haptic } from '../../utils/haptic';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { SHORTCUT_ICONS, SHORTCUT_ROUTES } from './shortcut-visuals';

// Hai sheet chỉ mở khi khách chạm: nạp lười để gói đầu không gánh chúng, và chỉ dựng từ lần mở đầu (giữ dựng sau đó để sheet đóng có hiệu ứng).
const EarnSheet = lazy(() => import('./earn-sheet').then((m) => ({ default: m.EarnSheet })));
const ShortcutsSheet = lazy(() => import('./shortcuts-sheet').then((m) => ({ default: m.ShortcutsSheet })));

const CELL_HEIGHT = 84;
const CIRCLE = 44;
const LABEL_LINE = 16;

// Hai dòng, cao cố định: 4 + 44 + 4 + 2×16 = 84, nên ô vẫn 84px và các ô thẳng hàng dù "Mã giảm giá" xuống dòng ở 375px (nhãn một dòng bị cắt "…" ở cả hai app).
const labelStyle = {
  maxWidth: '100%',
  height: LABEL_LINE * 2,
  lineHeight: `${LABEL_LINE}px`,
  textAlign: 'center',
  fontWeight: 600,
  textWrap: 'balance',
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
} as const;

const cellStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  height: CELL_HEIGHT,
  minHeight: 44,
  minWidth: 0,
  padding: '4px 2px 0',
  boxSizing: 'border-box',
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  cursor: 'pointer',
} as const;

/**
 * Lối tắt Trang chủ (Q7): 4 ô cố định + ô "Tất cả" trong MỘT hàng 5 cột đều nhau, không cuộn ngang. Phần còn lại (Đổi quà, Đơn hàng,
 * Kiếm tiền, Cộng đồng...) nằm trong sheet "Tất cả". Mục có cờ tắt (Đổi rác, Tích điểm đơn sàn) bị ẩn, mục kế lấp chỗ.
 * Nhãn tối đa hai dòng, không cắt chữ ở 375px và 320px; câu đọc đầy đủ nằm ở aria-label.
 */
export function ShortcutGrid() {
  const navigate = useNavigate();
  const cfg = usePublicConfig();
  const [earnOpen, setEarnOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [earnUsed, setEarnUsed] = useState(false);
  const [allUsed, setAllUsed] = useState(false);
  const authed = useAuthStore((st) => st.status === 'authenticated');
  const recycleOpenRequests = useRecycleOpenRequests(authed, cfg.isLoaded && !cfg.waste.enabled);
  const { pinned, all } = homeShortcutSlots({
    recycleOpenRequests,
    wasteEnabled: cfg.isLoaded && cfg.waste.enabled,
    claimEnabled: cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true,
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
    <section aria-label={homeCopy.shortcuts.title} style={{ padding: '0 8px' }}>
      <div data-testid="shortcut-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        {pinned.map((s) => {
          const tint = SHORTCUT_TINT_VARS[s.tint];
          return (
            <button
              key={s.id}
              type="button"
              aria-label={s.ariaLabel}
              className="tubu-press"
              onClick={() => {
                haptic('light');
                open(s);
              }}
              style={cellStyle}
            >
              <span aria-hidden style={{ width: CIRCLE, height: CIRCLE, borderRadius: 'var(--radius-pill)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center' }}>
                <Icon icon={SHORTCUT_ICONS[s.id]} size="md" tone="current" />
              </span>
              <Text variant="caption" style={labelStyle}>
                {s.label}
              </Text>
            </button>
          );
        })}
        <button
          type="button"
          aria-label={homeCopy.shortcuts.allAria}
          aria-haspopup="dialog"
          className="tubu-press"
          onClick={() => {
            haptic('light');
            setAllUsed(true);
            setAllOpen(true);
          }}
          style={cellStyle}
        >
          <span aria-hidden style={{ width: CIRCLE, height: CIRCLE, borderRadius: 'var(--radius-pill)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)', display: 'grid', placeItems: 'center' }}>
            <Icon icon={LayoutGrid} size="md" tone="current" />
          </span>
          <Text variant="caption" style={labelStyle}>
            {homeCopy.shortcuts.all}
          </Text>
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
