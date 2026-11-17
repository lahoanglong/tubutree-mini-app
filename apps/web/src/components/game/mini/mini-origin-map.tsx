'use client';

import { MAP_GEO_TRANSFORM, MAP_ISLANDS, MAP_REGIONS, geoToFrame, smoothRegionPath } from '@tubutree/app-core/brand-map-data';
import { ORIGIN_MAP_COPY, originMapPicked, originMapSpot } from '@tubutree/app-core/game-mini/origin-map';
import { Text } from '@/components/mini';

const PAD = 3;
const PIN_R = 2.6;
const framePts = [...MAP_REGIONS.flatMap((r) => r.points), ...MAP_ISLANDS.map((i) => i.at)].map(([x, y]) => geoToFrame({ x, y }));
const X0 = Math.min(...framePts.map((p) => p.x)) - PAD;
const Y0 = Math.min(...framePts.map((p) => p.y)) - PAD;
const VIEWBOX = `${X0.toFixed(2)} ${Y0.toFixed(2)} ${(Math.max(...framePts.map((p) => p.x)) + PAD - X0).toFixed(2)} ${(Math.max(...framePts.map((p) => p.y)) + PAD - Y0).toFixed(2)}`;
const PINS = MAP_ISLANDS.map((i) => ({ ...i, ...geoToFrame({ x: i.at[0], y: i.at[1] }) }));

/**
 * Bản đồ minh hoạ của Đoán Xuất Xứ (chỉ web từ 1024px, chunk lười): cùng hình sơ đồ với bản đồ "Hành trình nguyên liệu" (`brand-map-data`), có quần
 * đảo Hoàng Sa, Trường Sa và đảo Phú Quốc đánh số kèm chú giải. Tô vùng của lựa chọn đang đánh dấu; bản đồ không bấm được và không lộ đáp án.
 */
export default function MiniOriginMap({ place }: { place: string | null }) {
  const spot = originMapSpot(place);
  return (
    <figure className="tubu-mg-map" data-testid="mini-origin-map" data-spot={spot?.id}>
      <svg role="img" aria-label={ORIGIN_MAP_COPY.aria} viewBox={VIEWBOX}>
        <g transform={MAP_GEO_TRANSFORM}>
          {MAP_REGIONS.map((r) => (
            <path key={r.id} d={smoothRegionPath(r)} className="tubu-mg-map-land" data-on={spot?.id === r.id ? 'true' : undefined} />
          ))}
        </g>
        {PINS.map((i) => (
          <g key={i.id} aria-hidden="true">
            <circle cx={i.x} cy={i.y} r={PIN_R} className="tubu-mg-map-island" data-on={spot?.id === i.id ? 'true' : undefined} />
            <text x={i.x} y={i.y} className="tubu-mg-map-island-n">
              {i.n}
            </text>
          </g>
        ))}
      </svg>
      <ol className="tubu-mg-map-legend" aria-hidden="true">
        {MAP_ISLANDS.map((i) => (
          <li key={i.id}>
            <Text variant="caption" tone="secondary" as="span">
              {`${i.n}. ${i.label}`}
            </Text>
          </li>
        ))}
      </ol>
      <figcaption>
        <Text variant="body-sm" tone="secondary" as="span" data-testid="mini-origin-map-caption">
          {place ? originMapPicked(place) : ORIGIN_MAP_COPY.none}
        </Text>
      </figcaption>
    </figure>
  );
}
