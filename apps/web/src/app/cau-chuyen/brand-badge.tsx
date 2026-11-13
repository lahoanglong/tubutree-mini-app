import { BADGE_VIEWBOX, badgeBackground, drawBadge } from '@tubutree/app-core/brand-badges';

/** Huy hiệu minh hoạ của một nhãn (dữ liệu hình ở app-core, dùng chung với Mini App): ô nền nhạt theo màu nhãn, hình vector trang trí nên ẩn khỏi trình đọc màn hình. */
export function BrandBadge({ id, className }: { id: string; className: string }) {
  return (
    <span aria-hidden="true" data-testid={`brand-badge-${id}`} className={`grid shrink-0 place-items-center rounded-control ${className}`} style={{ background: badgeBackground(id) }}>
      <svg viewBox={BADGE_VIEWBOX} className="h-[80%] w-[80%]" focusable="false">
        {drawBadge(id).map((s, i) => (
          <path key={i} d={s.d} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </span>
  );
}
