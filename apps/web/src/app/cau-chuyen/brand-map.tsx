'use client';

import type { CSSProperties } from 'react';
import { BRAND_ORIGINS, type BrandOrigin } from '@/lib/brand-origins';
import { MAP_FRAME, MAP_GEO_TRANSFORM, MAP_GRATICULE, MAP_LAYOUT, MAP_REGIONS, MAP_VIEWBOX, smoothRegionPath } from '@tubutree/app-core/brand-map-data';
import './brand-theme.css';
import './brand-map.css';

const left = (x: number) => `${(x / MAP_FRAME.w) * 100}%`;
const top = (y: number) => `${(y / MAP_FRAME.h) * 100}%`;
const brandVar = (id: string) => ({ ['--pin']: `var(--color-brand-${id})` }) as CSSProperties;
const byId = new Map(BRAND_ORIGINS.map((o) => [o.id, o]));

export const MAP_LABEL = 'Bản đồ vùng nguyên liệu Việt Nam, vẽ sơ đồ';

/**
 * Bản đồ chú thích vùng nguyên liệu Việt Nam (bản đồ thực vật học hữu cơ): đường kinh vĩ tuyến mảnh, đường bao bờ biển mềm mại, chấm ghim đúng tỉnh
 * xuất xứ và tên nhãn xếp hai cột hai bên nối với chấm bằng đường dẫn mảnh. Nhãn là nút thật (Tab tới được, tên truy cập là tên nhãn và tỉnh).
 */
export function BrandMap({ onPick, activeId, sheetOpen }: { onPick: (loc: BrandOrigin) => void; activeId: string; sheetOpen: boolean }) {
  return (
    <div className="brandmap" data-testid="brand-map" data-sheet={sheetOpen ? '' : undefined} style={{ aspectRatio: `${MAP_FRAME.w} / ${MAP_FRAME.h}` }}>
      <svg role="img" aria-label={MAP_LABEL} viewBox={MAP_VIEWBOX} className="brandmap-svg">
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
          <line key={l.id} x1={l.edge.x} y1={l.edge.y} x2={l.pin.x} y2={l.pin.y} className="brandmap-leader" data-active={l.id === activeId ? '' : undefined} style={brandVar(l.id)} />
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
        <span key={l.id} aria-hidden="true" data-testid={`brand-map-pin-${l.id}`} className="brandmap-pin" data-active={l.id === activeId ? '' : undefined} style={{ ...brandVar(l.id), left: left(l.pin.x), top: top(l.pin.y) }} />
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
            className="brandmap-label"
            onClick={() => onPick(o)}
            style={{ ...brandVar(l.id), left: left(l.x0), width: `${((l.x1 - l.x0) / MAP_FRAME.w) * 100}%`, top: top(l.cy) }}
          >
            <span className="brandmap-label-name">{o.brand}</span>
            <span className="brandmap-label-sub">{o.province}</span>
          </button>
        );
      })}
    </div>
  );
}
