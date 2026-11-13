'use client';

import type { CSSProperties } from 'react';
import { BRAND_ORIGINS, type BrandOrigin } from '@/lib/brand-origins';
import { MAP_FRAME, MAP_GEO_TRANSFORM, MAP_LAYOUT, MAP_REGIONS, MAP_VIEWBOX, regionPath } from '@tubutree/app-core/brand-map-data';
import './brand-theme.css';
import './brand-map.css';

const left = (x: number) => `${(x / MAP_FRAME.w) * 100}%`;
const top = (y: number) => `${(y / MAP_FRAME.h) * 100}%`;
const brandVar = (id: string) => ({ ['--pin']: `var(--color-brand-${id})` }) as CSSProperties;
const byId = new Map(BRAND_ORIGINS.map((o) => [o.id, o]));

export const MAP_LABEL = 'Bản đồ vùng nguyên liệu Việt Nam, vẽ sơ đồ';

/**
 * Bản đồ chú thích vùng nguyên liệu Việt Nam (sơ đồ, không theo tỉ lệ): chấm ghim đúng tỉnh xuất xứ (không tương tác) và tên nhãn xếp hai cột hai bên,
 * nối với chấm bằng một đường dẫn. Nhãn là nút thật (Tab tới được, tên truy cập là tên nhãn và tỉnh). `activeId` là nhãn đang chọn; `sheetOpen` cho
 * biết tấm chi tiết đang mở (dưới md chỉ khi đó nhãn chọn mới sáng lên, từ md luôn sáng vì chi tiết nằm cạnh bản đồ). Hình học và vị trí ở app-core.
 */
export function BrandMap({ onPick, activeId, sheetOpen }: { onPick: (loc: BrandOrigin) => void; activeId: string; sheetOpen: boolean }) {
  return (
    <div className="brandmap" data-testid="brand-map" data-sheet={sheetOpen ? '' : undefined} style={{ aspectRatio: `${MAP_FRAME.w} / ${MAP_FRAME.h}` }}>
      <svg role="img" aria-label={MAP_LABEL} viewBox={MAP_VIEWBOX} className="brandmap-svg">
        <g transform={MAP_GEO_TRANSFORM}>
          {MAP_REGIONS.map((r) => (
            <path key={r.id} d={regionPath(r)} className="brandmap-land" data-origin={r.origin ? '' : undefined} />
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
