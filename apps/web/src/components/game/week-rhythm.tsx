'use client';

import { weekRhythmCopy, type RhythmCellState } from '@tubutree/app-core/game-week-rhythm';
import { useWeekRhythm } from './use-week-rhythm';

export interface WeekRhythmProps {
  streakDays: number | undefined;
  lastCheckInAt: string | null | undefined;
  /** Hôm nay đã tưới, điểm danh hay hứng sương (mini game tự đọc từ trạng thái Arcade). */
  activeToday: boolean;
}

const CELL: Record<RhythmCellState, string> = {
  done: 'bg-stone-0',
  'today-open': 'bg-forest-800 ring-2 ring-inset ring-stone-0',
  missed: 'bg-forest-800',
  upcoming: 'bg-transparent ring-1 ring-inset ring-forest-800',
};

// 💧 trong ô là dấu "đã chăm vườn" của game (cùng nghĩa với giọt nước ở chuỗi điểm danh), không phải icon chức năng.
/**
 * Dải "Nhịp Sống Xanh 7 Ngày" nằm trong thẻ đầu Vườn Xanh (cùng số đo với Mini App: dòng tiêu đề + hàng 7 ô cao 28px, tổng ≤ 52px): tuần giờ VN, mỗi ngày một ô, ô hôm nay có viền.
 * Chỉ để xem, không có nút: việc tưới và điểm danh vẫn là một nút chính của trang.
 */
export function WeekRhythm(props: WeekRhythmProps) {
  const { cells, doneCount } = useWeekRhythm(props);
  return (
    <div role="group" aria-label={weekRhythmCopy.listLabel(doneCount)} data-testid="week-rhythm" className="mt-2 flex flex-col gap-1 text-left">
      <div className="flex items-baseline justify-between gap-2 text-label text-stone-0">
        <div className="font-bold">{weekRhythmCopy.title}</div>
        <div className="tabular-nums">{weekRhythmCopy.count(doneCount)}</div>
      </div>
      <ul className="m-0 grid list-none grid-cols-7 gap-1 p-0">
        {cells.map((c) => (
          <li
            key={c.key}
            data-state={c.state}
            data-today={c.today ? 'true' : undefined}
            aria-label={c.aria}
            aria-current={c.today ? 'date' : undefined}
            className={`grid h-7 place-items-center rounded-full text-label font-semibold text-stone-0 ${CELL[c.state]}`}
          >
            <span aria-hidden="true">{c.state === 'done' ? '💧' : c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
