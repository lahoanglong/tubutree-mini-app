import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './ui/icon-button';
import { Text } from './ui/text';

export interface PeriodNavProps {
  /** Nhãn kỳ đang xem, vd "Tháng 3/2026". */
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
}

/** Thanh chuyển kỳ (tháng/tuần) của màn nhân sự: hai nút chỉ-icon 44px có tên và nhãn kỳ ở giữa.
 * `aria-live` để người dùng đọc màn hình nghe được kỳ mới sau mỗi lần chuyển. */
export function PeriodNav({ label, prevLabel, nextLabel, onPrev, onNext }: PeriodNavProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        padding: '0 4px',
      }}
    >
      <IconButton icon={ChevronLeft} label={prevLabel} onPress={onPrev} />
      <div aria-live="polite">
        <Text variant="body-sm" style={{ fontWeight: 700 }}>
          {label}
        </Text>
      </div>
      <IconButton icon={ChevronRight} label={nextLabel} onPress={onNext} />
    </div>
  );
}
