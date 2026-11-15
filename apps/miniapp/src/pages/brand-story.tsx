import { useEffect, useState, type CSSProperties } from 'react';
import { Page, useLocation } from 'zmp-ui';
import { useSmartNavigate } from '../lib/smart-nav';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { BADGE_VIEWBOX, badgeBackground, drawBadge } from '@tubutree/app-core/brand-badges';
import { MAP_FRAME, MAP_GEO_TRANSFORM, MAP_GRATICULE, MAP_LAYOUT, MAP_REGIONS, MAP_VIEWBOX, smoothRegionPath } from '@tubutree/app-core/brand-map-data';
import { api } from '../services/api';
import type { PageResponse, ProductCard } from '../services/shop-api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { BRAND_ORIGINS, brandBrowseTarget, type BrandOrigin } from '../utils/brand-origins';
import { vi } from '../i18n/vi';
import { PageHeader } from '../components/ui/page-header';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { ProductThumb } from '../components/ui/product-thumb';
import { Text, Heading } from '../components/ui/text';
import '../css/brand-theme.css';
import '../css/brand-map.css';

const left = (x: number) => `${(x / MAP_FRAME.w) * 100}%`;
const top = (y: number) => `${(y / MAP_FRAME.h) * 100}%`;
const accent = (id: string) => ({ ['--pin']: `var(--color-brand-${id})` }) as CSSProperties;
const byId = new Map(BRAND_ORIGINS.map((o) => [o.id, o]));

const PROVENANCE_PILLARS = [
  { num: '01', title: 'Bản địa minh bạch', body: '8 vùng nguyên liệu từ Thanh Hóa đến Cửu Long' },
  { num: '02', title: 'Lên men & ép lạnh', body: 'Giữ hoạt chất thực vật lành tính nguyên bản' },
  { num: '03', title: 'Tuần hoàn vỏ chai', body: 'Thu hồi vỏ sạch miễn ship kèm đơn tiếp theo' },
] as const;

const miniRegionCache = new Map<string, ProductCard[]>();

function useMiniRegionProducts(keyword: string | null): ProductCard[] {
  const [items, setItems] = useState<ProductCard[]>(() => (keyword ? miniRegionCache.get(keyword) ?? [] : []));

  useEffect(() => {
    if (!keyword) {
      setItems([]);
      return;
    }
    const cached = miniRegionCache.get(keyword);
    if (cached) {
      setItems(cached);
      return;
    }
    let cancelled = false;
    setItems([]);
    Promise.resolve()
      .then(() => api?.get<PageResponse<ProductCard>>('/products', { params: { page: 1, limit: 4, q: keyword } }))
      .then((res) => {
        if (cancelled) return;
        const next = Array.isArray(res?.data?.data) ? res.data.data.slice(0, 4) : [];
        miniRegionCache.set(keyword, next);
        setItems(next);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [keyword]);

  return items;
}

export default function BrandStoryPage() {
  const { search } = useLocation();
  const [selected, setSelected] = useState<BrandOrigin | null>(() => {
    const id = new URLSearchParams(search).get('brand');
    return BRAND_ORIGINS.find((o) => o.id === id) ?? null;
  });
  const regionProducts = useMiniRegionProducts(selected?.searchKeyword ?? null);

  const pick = (loc: BrandOrigin) => {
    haptic('light');
    setSelected(loc);
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'var(--space-stack-xl)' }}>
      <PageHeader title={vi.home.brandStoryTitle} />
      <div style={{ padding: 'var(--space-inset-page) var(--space-inset-page) var(--space-stack-sm)' }}>
        <Text tone="secondary" as="p" style={{ lineHeight: 1.5 }}>
          Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Chạm tên thương hiệu trên bản đồ vùng nguyên liệu Việt Nam để khám phá xuất xứ.
        </Text>
        <div
          style={{
            marginTop: 'var(--space-inline-md)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 'var(--space-inline-sm)',
          }}
        >
          {PROVENANCE_PILLARS.map((p) => (
            <div
              key={p.num}
              style={{
                padding: 'var(--space-inline-sm)',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-surface)',
              }}
            >
              <span
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--type-label-size)',
                  fontWeight: 600,
                  color: 'var(--color-text-brand)',
                }}
              >
                {p.num}
              </span>
              <span
                style={{
                  display: 'block',
                  marginTop: 'var(--space-inline-xs)',
                  fontSize: 'var(--type-label-size)',
                  fontWeight: 600,
                  lineHeight: 1.35,
                  color: 'var(--color-text-primary)',
                }}
              >
                {p.title}
              </span>
              <span
                style={{
                  display: 'block',
                  marginTop: 'var(--space-inline-xs)',
                  fontSize: 'var(--type-label-size)',
                  lineHeight: 1.35,
                  color: 'var(--color-text-secondary)',
                }}
              >
                {p.body}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 var(--space-inset-page)' }}>
        <IngredientMap onPick={pick} activeId={selected?.id ?? null} />
      </div>

      <div style={{ padding: 'var(--space-inset-page) var(--space-inset-page) var(--space-stack-sm)' }}>
        <Heading variant="title-sm" as="h2">
          {BRAND_ORIGINS.length} Thương hiệu & Tỉnh thành xuất xứ
        </Heading>
      </div>

      <div style={{ padding: '0 var(--space-inset-page) var(--space-section)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-inline-md)' }}>
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
              <Text variant="body-sm" tone="secondary" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-stack-xs)', minWidth: 0 }}>
                <MapPin aria-hidden="true" width={14} height={14} style={{ flex: '0 0 auto' }} />
                {selected.province} · {selected.ingredient}
              </Text>
            </div>
            <Text as="p" style={{ lineHeight: 1.6, marginTop: 'var(--space-inset-page)' }}>
              {selected.story}
            </Text>
            <BrowseButton origin={selected} onGo={() => setSelected(null)} />
            <MiniRegionProductShelf province={selected.province} items={regionProducts} onDone={() => setSelected(null)} />
          </>
        )}
      </BottomSheet>
    </Page>
  );
}

function MiniRegionProductShelf({
  province,
  items,
  onDone,
}: {
  province: string;
  items: readonly ProductCard[];
  onDone: () => void;
}) {
  const goSmart = useSmartNavigate();
  if (items.length === 0) return null;
  return (
    <div
      data-testid="brand-region-products"
      style={{
        marginTop: 'var(--space-inset-page)',
        paddingTop: 'var(--space-inline-md)',
        borderTop: '1px solid var(--color-border-subtle)',
      }}
    >
      <Text variant="label" tone="secondary" as="h3" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Sản phẩm tiêu biểu từ {province}
      </Text>
      <div style={{ marginTop: 'var(--space-stack-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
        {items.map((p) => {
          const price = p.salePrice ?? p.basePrice;
          return (
            <button
              key={p.id}
              type="button"
              className="tubu-press tubu-hit-44"
              onClick={() => {
                onDone();
                goSmart(`/product/${p.slug}`);
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-inline-md)',
                padding: 'var(--space-inline-sm)',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-canvas)',
                textAlign: 'left',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <ProductThumb src={p.thumbnail} alt="" size={48} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 'var(--type-caption-size)',
                    fontWeight: 600,
                    lineHeight: 1.35,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {p.name}
                </span>
                <span
                  style={{
                    marginTop: 'var(--space-inline-xs)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-inline-sm)',
                    fontSize: 'var(--type-label-size)',
                  }}
                >
                  <span style={{ fontWeight: 700, color: 'var(--color-text-brand)' }}>{formatVnd(price)}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-inline-xs)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                    Xem sản phẩm
                    <ArrowUpRight width={14} height={14} aria-hidden="true" />
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
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
 * Bản đồ chú thích vùng nguyên liệu Việt Nam (bản đồ thực vật học hữu cơ): chấm ghim đúng tỉnh xuất xứ và tên nhãn xếp hai cột hai bên.
 */
function IngredientMap({ onPick, activeId }: { onPick: (loc: BrandOrigin) => void; activeId: string | null }) {
  return (
    <div className="brandmap" data-testid="brand-map" data-sheet={activeId ? '' : undefined} style={{ aspectRatio: `${MAP_FRAME.w} / ${MAP_FRAME.h}` }}>
      <svg role="img" aria-label="Bản đồ vùng nguyên liệu Việt Nam, vẽ sơ đồ" viewBox={MAP_VIEWBOX} className="brandmap-svg">
        <g aria-hidden="true" className="brandmap-grid">
          {MAP_GRATICULE.parallels.map((y) => (
            <line key={`p-${y}`} x1={0} y1={y} x2={MAP_FRAME.w} y2={y} />
          ))}
          {MAP_GRATICULE.meridians.map((x) => (
            <line key={`m-${x}`} x1={x} y1={0} x2={x} y2={MAP_FRAME.h - 12} />
          ))}
        </g>
        <g aria-hidden="true" className="brandmap-compass" transform="translate(65 9)">
          <circle cx="0" cy="0" r="3.4" className="brandmap-compass-ring" />
          <path d="M0 -4.8 L1.1 0 L0 -1 L-1.1 0 Z" className="brandmap-compass-north" />
          <path d="M0 4.8 L0.9 0 L0 1 L-0.9 0 Z" className="brandmap-compass-south" />
        </g>
        <g transform={MAP_GEO_TRANSFORM}>
          {MAP_REGIONS.filter((r) => r.origin).map((r) => (
            <path key={`halo-${r.id}`} d={smoothRegionPath(r)} className="brandmap-coast-halo" />
          ))}
          {MAP_REGIONS.map((r) => (
            <path key={r.id} d={smoothRegionPath(r)} className="brandmap-land" data-origin={r.origin ? '' : undefined} />
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
  const goSmart = useSmartNavigate();
  return (
    <Button
      fullWidth
      onPress={() => {
        onGo();
        goSmart(brandBrowseTarget(origin, '/browse'));
      }}
      style={{ marginTop: 16 }}
    >
      Khám phá sản phẩm {origin.brand}
    </Button>
  );
}
