import { useState, type CSSProperties } from 'react';
import { Page, useLocation, useNavigate } from 'zmp-ui';
import { MapPin } from 'lucide-react';
import { BADGE_VIEWBOX, badgeBackground, drawBadge } from '@tubutree/app-core/brand-badges';
import { MAP_FRAME, MAP_GEO_TRANSFORM, MAP_LAYOUT, MAP_REGIONS, MAP_VIEWBOX, regionPath } from '@tubutree/app-core/brand-map-data';
import { haptic } from '../utils/haptic';
import { BRAND_ORIGINS, brandBrowseTarget, type BrandOrigin } from '../utils/brand-origins';
import { vi } from '../i18n/vi';
import { PageHeader } from '../components/ui/page-header';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Text, Heading } from '../components/ui/text';
import '../css/brand-theme.css';
import '../css/brand-map.css';

const left = (x: number) => `${(x / MAP_FRAME.w) * 100}%`;
const top = (y: number) => `${(y / MAP_FRAME.h) * 100}%`;
const accent = (id: string) => ({ ['--pin']: `var(--color-brand-${id})` }) as CSSProperties;
const byId = new Map(BRAND_ORIGINS.map((o) => [o.id, o]));

export default function BrandStoryPage() {
  const { search } = useLocation();
  const [selected, setSelected] = useState<BrandOrigin | null>(() => {
    const id = new URLSearchParams(search).get('brand');
    return BRAND_ORIGINS.find((o) => o.id === id) ?? null;
  });
  const pick = (loc: BrandOrigin) => {
    haptic('light');
    setSelected(loc);
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 32 }}>
      <PageHeader title={vi.home.brandStoryTitle} />
      <div style={{ padding: '16px 16px 8px' }}>
        <Text tone="secondary" as="p" style={{ lineHeight: 1.5 }}>
          Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Chạm tên thương hiệu trên bản đồ vùng nguyên liệu Việt Nam để khám phá xuất xứ.
        </Text>
      </div>

      <div style={{ padding: '0 16px' }}>
        <IngredientMap onPick={pick} activeId={selected?.id ?? null} />
      </div>

      <div style={{ padding: '16px 16px 8px' }}>
        <Heading variant="title-sm" as="h2">
          {BRAND_ORIGINS.length} Thương hiệu & Tỉnh thành xuất xứ
        </Heading>
      </div>

      <div style={{ padding: '0 16px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {BRAND_ORIGINS.map((loc) => (
          <button key={loc.id} type="button" className="brandcard tubu-press" data-testid={`brand-card-${loc.id}`} onClick={() => pick(loc)}>
            <BrandBadge id={loc.id} />
            <span className="brandcard-body">
              <span className="brandcard-name">{loc.brand}</span>
              <span className="brandcard-sub">
                <MapPin aria-hidden="true" />
                <span>{loc.province}</span>
              </span>
              <span className="brandcard-sub" data-plain="">
                {loc.ingredient}
              </span>
            </span>
          </button>
        ))}
      </div>

      <BottomSheet open={selected != null} onClose={() => setSelected(null)} title={selected?.brand}>
        {selected && (
          <>
            <div className="brandsheet-head">
              <BrandBadge id={selected.id} large />
              <Text variant="body-sm" tone="secondary" style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <MapPin aria-hidden="true" width={14} height={14} style={{ flex: '0 0 auto' }} />
                {selected.province} · {selected.ingredient}
              </Text>
            </div>
            <Text as="p" style={{ lineHeight: 1.6, marginTop: 16 }}>
              {selected.story}
            </Text>
            <BrowseButton origin={selected} onGo={() => setSelected(null)} />
          </>
        )}
      </BottomSheet>
    </Page>
  );
}

/** Huy hiệu minh hoạ của nhãn (dữ liệu hình ở app-core, dùng chung với web): ô nền nhạt theo màu nhãn, hình trang trí nên ẩn khỏi trình đọc màn hình. */
function BrandBadge({ id, large }: { id: string; large?: boolean }) {
  return (
    <span aria-hidden="true" className="brandcard-badge" data-large={large ? '' : undefined} data-testid={`brand-badge-${id}`} style={{ background: badgeBackground(id) }}>
      <svg viewBox={BADGE_VIEWBOX} focusable="false">
        {drawBadge(id).map((s, i) => (
          <path key={i} d={s.d} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </span>
  );
}

/**
 * Bản đồ chú thích vùng nguyên liệu Việt Nam (sơ đồ): chấm ghim đúng tỉnh xuất xứ (không tương tác) và tên nhãn xếp hai cột hai bên, nối với chấm
 * bằng một đường dẫn. Nhãn là nút thật. Hình học và vị trí ở `packages/app-core/src/brand-map-data.ts`, dùng chung với web.
 */
function IngredientMap({ onPick, activeId }: { onPick: (loc: BrandOrigin) => void; activeId: string | null }) {
  return (
    <div className="brandmap" data-testid="brand-map" data-sheet={activeId ? '' : undefined} style={{ aspectRatio: `${MAP_FRAME.w} / ${MAP_FRAME.h}` }}>
      <svg role="img" aria-label="Bản đồ vùng nguyên liệu Việt Nam, vẽ sơ đồ" viewBox={MAP_VIEWBOX} className="brandmap-svg">
        <g transform={MAP_GEO_TRANSFORM}>
          {MAP_REGIONS.map((r) => (
            <path key={r.id} d={regionPath(r)} className="brandmap-land" data-origin={r.origin ? '' : undefined} />
          ))}
        </g>
        {MAP_LAYOUT.labels.map((l) => (
          <line key={l.id} x1={l.edge.x} y1={l.edge.y} x2={l.pin.x} y2={l.pin.y} className="brandmap-leader" data-active={l.id === activeId ? '' : undefined} style={accent(l.id)} />
        ))}
      </svg>
      {MAP_LAYOUT.islands.map((i) => (
        <span key={i.id} aria-hidden="true" data-testid={`brand-map-island-${i.id}`} className="brandmap-islandpin" style={{ left: left(i.x), top: top(i.y) }}>
          {i.n}
        </span>
      ))}
      <p className="brandmap-legend" data-testid="brand-map-legend">
        {MAP_LAYOUT.islands.map((i) => (
          <span key={i.id} className="brandmap-legend-item">
            <span aria-hidden="true" className="brandmap-islandpin" data-inline="">
              {i.n}
            </span>
            {i.label}
          </span>
        ))}
      </p>
      {MAP_LAYOUT.labels.map((l) => (
        <span key={l.id} aria-hidden="true" data-testid={`brand-map-pin-${l.id}`} className="brandmap-pin" data-active={l.id === activeId ? '' : undefined} style={{ ...accent(l.id), left: left(l.pin.x), top: top(l.pin.y) }} />
      ))}
      {MAP_LAYOUT.labels.map((l) => {
        const o = byId.get(l.id)!;
        return (
          <button
            key={l.id}
            type="button"
            data-testid={`brand-map-label-${l.id}`}
            data-side={l.side}
            data-active={l.id === activeId ? '' : undefined}
            className="brandmap-label tubu-press"
            onClick={() => onPick(o)}
            style={{ ...accent(l.id), left: left(l.x0), width: `${((l.x1 - l.x0) / MAP_FRAME.w) * 100}%`, top: top(l.cy) }}
          >
            <span className="brandmap-label-name">{o.brand}</span>
            <span className="brandmap-label-sub">{o.province}</span>
          </button>
        );
      })}
    </div>
  );
}

function BrowseButton({ origin, onGo }: { origin: BrandOrigin; onGo: () => void }) {
  const navigate = useNavigate();
  return (
    <Button
      fullWidth
      onPress={() => {
        onGo();
        navigate(brandBrowseTarget(origin, '/browse'));
      }}
      style={{ marginTop: 16 }}
    >
      Khám phá sản phẩm {origin.brand}
    </Button>
  );
}
