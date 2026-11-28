// Nguồn: apps/miniapp/src/components/game/burst.tsx (giữ giống hệt).
import type { CSSProperties } from 'react';

const COLORS = ['var(--forest-400)', 'var(--honey-500)', 'var(--clay-500)', 'var(--blue-600)', 'var(--forest-200)', 'var(--honey-600)'];
const COUNT = 14;

// Hướng bay đều quanh tâm, xa gần xen kẽ để không thành một vòng tròn cứng. Số không đơn vị: CSS nhân với 1px (bánh cóc px chỉ đếm TSX).
const PARTICLES = Array.from({ length: COUNT }, (_, i) => {
  const angle = (i / COUNT) * Math.PI * 2;
  const dist = i % 2 === 0 ? 70 : 48;
  return {
    style: {
      '--bx': Math.round(Math.cos(angle) * dist),
      '--by': Math.round(Math.sin(angle) * dist),
      '--bd': (i % 4) * 40,
      background: COLORS[i % COLORS.length],
    } as CSSProperties,
    round: i % 3 === 0,
  };
});

/**
 * Chùm lấp lánh bung ra một lần quanh tâm khối cha (khối cha cần `position: relative`). Chỉ để trang trí: `aria-hidden`, không bắt chạm, và CSS
 * ẩn hẳn khi máy bật giảm chuyển động. Đổi `key` để bung lại.
 */
export function Burst() {
  return (
    <span className="tubu-burst" aria-hidden data-testid="burst">
      {PARTICLES.map((p, i) => (
        <span key={i} className="tubu-burst-bit" data-round={p.round || undefined} style={p.style} />
      ))}
    </span>
  );
}
