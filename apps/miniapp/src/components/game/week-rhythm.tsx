import { weekRhythmCopy } from '@tubutree/app-core/game-week-rhythm';
import { Text } from '../ui/text';
import { useWeekRhythm } from './use-week-rhythm';
import '../../css/week-rhythm.css';

export interface WeekRhythmProps {
  streakDays: number | undefined;
  lastCheckInAt: string | null | undefined;
  /** Hôm nay đã tưới, điểm danh hay hứng sương (mini game tự đọc từ trạng thái Arcade). */
  activeToday: boolean;
}

// 💧 trong ô là dấu "đã chăm vườn" của game (cùng nghĩa với giọt nước ở chuỗi điểm danh), không phải icon chức năng.
/**
 * Dải "Nhịp Sống Xanh 7 Ngày" nằm trong thẻ đầu Vườn Xanh: tuần giờ VN, mỗi ngày một ô, ô hôm nay có viền. Chỉ để xem, không có nút: việc tưới và điểm danh vẫn
 * là một nút chính của trang. Cao ≤ 52px.
 */
export function WeekRhythm(props: WeekRhythmProps) {
  const { cells, doneCount } = useWeekRhythm(props);
  return (
    <div role="group" aria-label={weekRhythmCopy.listLabel(doneCount)} className="tubu-rhythm" data-testid="week-rhythm">
      <div className="tubu-rhythm-head">
        <Text variant="label" tone="inverse" as="div" style={{ fontWeight: 700 }}>
          {weekRhythmCopy.title}
        </Text>
        <Text variant="label" tone="inverse" as="div" numeric>
          {weekRhythmCopy.count(doneCount)}
        </Text>
      </div>
      <ul className="tubu-rhythm-days">
        {cells.map((c) => (
          <li key={c.key} className="tubu-rhythm-day" data-state={c.state} data-today={c.today ? 'true' : undefined} aria-label={c.aria} aria-current={c.today ? 'date' : undefined}>
            <Text variant="label" tone="inverse" as="span" aria-hidden="true">
              {c.state === 'done' ? '💧' : c.label}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}
